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
    const shared = this.getSharedNgrams(filePath);
    if (shared.length === 0) return [];

    // Get the actual ngram entries for this file to get offsets
    const fileNgramMap = new Map();
    for (const ng of (this.fileNgrams.get(filePath) || [])) {
      if (!fileNgramMap.has(ng.stemmed)) {
        fileNgramMap.set(ng.stemmed, ng);
      }
    }

    const spans = [];
    for (const ng of shared) {
      const entry = fileNgramMap.get(ng.stemmed);
      if (!entry) continue;
      spans.push({
        startOffset: entry.startOffset,
        endOffset: entry.endOffset,
        line: entry.line,
        tag: entry.tag,
        original: entry.original,
      });
    }

    // Sort by startOffset
    spans.sort((a, b) => a.startOffset - b.startOffset);

    // Merge overlapping spans
    const merged = [];
    for (const span of spans) {
      if (merged.length === 0) {
        merged.push({ ...span });
        continue;
      }
      const last = merged[merged.length - 1];
      if (span.startOffset < last.endOffset) {
        // Overlapping — extend
        if (span.endOffset > last.endOffset) {
          last.endOffset = span.endOffset;
          last.original = last.original; // keep first original for display
        }
      } else {
        merged.push({ ...span });
      }
    }

    return merged;
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
