import natural from 'natural';
import { extractSegments } from './extractor.js';

const { PorterStemmer, WordTokenizer } = natural;
const tokenizer = new WordTokenizer();

export class Indexer {
  constructor({ ngramMin = 3, ngramMax = 8 } = {}) {
    this.ngramMin = ngramMin;
    this.ngramMax = ngramMax;
    // inverted index: stemmedKey -> [{file, line, tag, original, startOffset, endOffset}]
    this.index = new Map();
    // file -> [{stemmed, original, tag, line, startOffset, endOffset}]
    this.fileNgrams = new Map();
    // file -> totalLength (word count)
    this.fileLengths = new Map();
  }

  buildIndex(files) {
    for (const file of files) {
      this._indexFile(file.relativePath, file.content);
    }
  }

  _indexFile(filePath, content) {
    const segments = extractSegments(content);
    const ngrams = [];
    let totalWords = 0;

    for (const seg of segments) {
      const words = tokenizer.tokenize(seg.text);
      if (!words || words.length === 0) continue;
      totalWords += words.length;

      const stemmed = words.map(w => PorterStemmer.stem(w));
      const segNgrams = this._generateNgrams(words, stemmed, seg.tag, seg.line, seg.text);
      // Store segment text on each n-gram for span reconstruction
      for (const ng of segNgrams) {
        ng.segmentText = seg.text;
      }
      ngrams.push(...segNgrams);

      for (const ng of segNgrams) {
        if (!this.index.has(ng.stemmed)) {
          this.index.set(ng.stemmed, []);
        }
        this.index.get(ng.stemmed).push({
          file: filePath,
          line: ng.line,
          tag: ng.tag,
          original: ng.original,
          startOffset: ng.startOffset,
          endOffset: ng.endOffset,
        });
      }
    }

    this.fileNgrams.set(filePath, ngrams);
    this.fileLengths.set(filePath, totalWords);
  }

  _generateNgrams(words, stemmedWords, tag, line, segText) {
    const ngrams = [];
    const n = words.length;

    // Build word offsets within segment text for startOffset/endOffset tracking
    const wordOffsets = [];
    let searchFrom = 0;
    for (const word of words) {
      const idx = segText.indexOf(word, searchFrom);
      if (idx === -1) {
        wordOffsets.push(searchFrom);
      } else {
        wordOffsets.push(idx);
        searchFrom = idx + word.length;
      }
    }

    for (let size = this.ngramMin; size <= this.ngramMax; size++) {
      for (let i = 0; i <= n - size; i++) {
        const stemmedKey = stemmedWords.slice(i, i + size).join(' ');
        const originalText = words.slice(i, i + size).join(' ');
        const startOffset = wordOffsets[i];
        const endWord = i + size - 1;
        const endOffset = wordOffsets[endWord] + words[endWord].length;

        ngrams.push({
          stemmed: stemmedKey,
          original: originalText,
          tag,
          line,
          startOffset,
          endOffset,
        });
      }
    }

    return ngrams;
  }

  getSharedNgrams(filePath) {
    const ngrams = this.fileNgrams.get(filePath);
    if (!ngrams) return [];

    const seen = new Set();
    const result = [];

    for (const ng of ngrams) {
      if (seen.has(ng.stemmed)) continue;
      const locations = this.index.get(ng.stemmed) || [];
      const otherFiles = locations.filter(loc => loc.file !== filePath);
      if (otherFiles.length === 0) continue;

      seen.add(ng.stemmed);
      result.push({
        stemmed: ng.stemmed,
        original: ng.original,
        tag: ng.tag,
        line: ng.line,
        count: locations.length,
        locations,
      });
    }

    return result;
  }

  getAllNgramsForFile(filePath) {
    return this.fileNgrams.get(filePath) || [];
  }

  getNgramLocations(stemmedNgram) {
    return this.index.get(stemmedNgram) || [];
  }

  getMergedSpans(filePath) {
    const sharedKeys = new Set();
    for (const ng of this.getSharedNgrams(filePath)) {
      sharedKeys.add(ng.stemmed);
    }
    if (sharedKeys.size === 0) return [];

    // Collect ALL occurrences of shared n-grams in this file (not deduplicated)
    const allNgrams = this.fileNgrams.get(filePath) || [];
    const spans = [];
    for (const ng of allNgrams) {
      if (!sharedKeys.has(ng.stemmed)) continue;
      const locs = this.index.get(ng.stemmed) || [];
      spans.push({
        startOffset: ng.startOffset,
        endOffset: ng.endOffset,
        line: ng.line,
        tag: ng.tag,
        original: ng.original,
        segmentText: ng.segmentText,
        count: locs.length,
        stemmed: ng.stemmed,
      });
    }

    // Sort by line first, then startOffset
    spans.sort((a, b) => a.line - b.line || a.startOffset - b.startOffset);

    // Merge overlapping spans within the same segment (same line)
    // Track all stemmed keys absorbed into each merged span
    const merged = [];
    for (const span of spans) {
      if (merged.length === 0) {
        merged.push({ ...span, stemmedKeys: [span.stemmed] });
        continue;
      }
      const last = merged[merged.length - 1];
      if (last.line === span.line && span.startOffset <= last.endOffset) {
        // Overlapping within same segment — extend
        last.stemmedKeys.push(span.stemmed);
        if (span.endOffset > last.endOffset) {
          last.endOffset = span.endOffset;
        }
        last.count = Math.max(last.count, span.count);
        // Keep the longest stemmed key as the primary
        if (span.stemmed.split(' ').length > last.stemmed.split(' ').length) {
          last.stemmed = span.stemmed;
        }
      } else {
        merged.push({ ...span, stemmedKeys: [span.stemmed] });
      }
    }

    // Rebuild original text from segment text using offsets
    for (const span of merged) {
      if (span.segmentText) {
        span.original = span.segmentText.slice(span.startOffset, span.endOffset);
      }
    }

    return merged.map(s => ({
      startOffset: s.startOffset,
      endOffset: s.endOffset,
      line: s.line,
      tag: s.tag,
      original: s.original,
      count: s.count,
      stemmed: s.stemmed,
      stemmedKeys: [...new Set(s.stemmedKeys)],
    }));
  }

  getPairwiseScores(filePath) {
    const shared = this.getSharedNgrams(filePath);
    const scores = {};

    for (const ng of shared) {
      const ngramLen = ng.stemmed.split(' ').length;
      for (const loc of ng.locations) {
        if (loc.file === filePath) continue;
        if (!scores[loc.file]) scores[loc.file] = { sharedNgrams: 0, score: 0 };
        scores[loc.file].sharedNgrams++;
        scores[loc.file].score += ngramLen * ngramLen;
      }
    }

    return Object.entries(scores)
      .map(([file, data]) => ({ file, ...data }))
      .sort((a, b) => b.score - a.score);
  }

  getRedundancyReport() {
    const report = [];

    for (const [filePath] of this.fileNgrams) {
      const shared = this.getSharedNgrams(filePath);
      const totalLength = this.fileLengths.get(filePath) || 1;

      // score = sum(ngramLength² × occurrenceCount) / totalLength
      // Use a Set to avoid double-counting same stemmed key
      let rawScore = 0;
      for (const ng of shared) {
        const ngramLength = ng.stemmed.split(' ').length;
        const occurrenceCount = ng.locations.length;
        rawScore += ngramLength * ngramLength * occurrenceCount;
      }

      const score = totalLength > 0 ? rawScore / totalLength : 0;
      report.push({ file: filePath, score, totalLength, rawScore });
    }

    report.sort((a, b) => b.score - a.score);
    return report;
  }

  reindexFile(filePath, content) {
    // Remove old index entries for this file
    for (const [key, locations] of this.index) {
      const filtered = locations.filter(loc => loc.file !== filePath);
      if (filtered.length === 0) {
        this.index.delete(key);
      } else {
        this.index.set(key, filtered);
      }
    }
    this.fileNgrams.delete(filePath);
    this.fileLengths.delete(filePath);

    // Re-index
    this._indexFile(filePath, content);
  }
}
