import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Indexer } from '../src/indexer.js';

describe('Indexer', () => {
  const files = [
    {
      relativePath: 'a.md',
      content: '# Intro\n\nThis guide will help you get started with installation and configuration.',
    },
    {
      relativePath: 'b.md',
      content: '# Guide\n\nThis guide will help you get started with installation and configuration.\n\n## Extra\n\nSome unique content here.',
    },
    {
      relativePath: 'c.md',
      content: '# Reference\n\nCompletely different content about API endpoints.',
    },
  ];

  it('builds index and finds shared n-grams', () => {
    const indexer = new Indexer({ ngramMin: 3, ngramMax: 8 });
    indexer.buildIndex(files);
    const shared = indexer.getSharedNgrams('a.md');
    assert.ok(shared.length > 0, 'should find shared n-grams between a.md and b.md');
    const hasMatch = shared.some(ng =>
      ng.locations.some(loc => loc.file === 'b.md')
    );
    assert.ok(hasMatch, 'shared n-grams should reference b.md');
  });

  it('does not report n-grams unique to one file', () => {
    const indexer = new Indexer({ ngramMin: 3, ngramMax: 8 });
    indexer.buildIndex(files);
    const shared = indexer.getSharedNgrams('c.md');
    assert.equal(shared.length, 0, 'c.md has no content in common with others');
  });

  it('uses stemming to match word variants', () => {
    const variantFiles = [
      { relativePath: 'x.md', content: 'The installing process requires careful configuration steps.' },
      { relativePath: 'y.md', content: 'The installation process requires careful configuration steps.' },
    ];
    const indexer = new Indexer({ ngramMin: 3, ngramMax: 8 });
    indexer.buildIndex(variantFiles);
    const shared = indexer.getSharedNgrams('x.md');
    assert.ok(shared.length > 0, 'stemming should match installing/installation');
  });

  it('stores original text alongside stemmed form', () => {
    const indexer = new Indexer({ ngramMin: 3, ngramMax: 8 });
    indexer.buildIndex(files);
    const shared = indexer.getSharedNgrams('a.md');
    for (const ng of shared) {
      assert.ok(ng.stemmed, 'should have stemmed form');
      assert.ok(ng.original, 'should have original text');
    }
  });

  it('computes redundancy scores', () => {
    const indexer = new Indexer({ ngramMin: 3, ngramMax: 8 });
    indexer.buildIndex(files);
    const report = indexer.getRedundancyReport();
    const aScore = report.find(r => r.file === 'a.md');
    const cScore = report.find(r => r.file === 'c.md');
    assert.ok(aScore.score > 0, 'a.md should have redundancy');
    assert.equal(cScore.score, 0, 'c.md should have zero redundancy');
  });

  it('merges overlapping n-gram matches into longest spans', () => {
    const indexer = new Indexer({ ngramMin: 3, ngramMax: 8 });
    indexer.buildIndex(files);
    const spans = indexer.getMergedSpans('a.md');
    assert.ok(spans.length > 0);
    for (let i = 1; i < spans.length; i++) {
      assert.ok(
        spans[i].startOffset >= spans[i - 1].endOffset,
        'spans should not overlap'
      );
    }
  });

  it('finds all locations of a specific n-gram', () => {
    const indexer = new Indexer({ ngramMin: 3, ngramMax: 8 });
    indexer.buildIndex(files);
    const shared = indexer.getSharedNgrams('a.md');
    if (shared.length > 0) {
      const locations = indexer.getNgramLocations(shared[0].stemmed);
      assert.ok(locations.length >= 2, 'shared n-gram should appear in 2+ files');
      assert.ok(locations.every(loc => loc.file && typeof loc.line === 'number'));
    }
  });

  it('tags n-grams as prose or code', () => {
    const codeFiles = [
      { relativePath: 'p.md', content: '# Title\n\n```js\nconst x = 1;\nconst y = 2;\nconst z = 3;\n```\n\nSome prose about the code above.' },
      { relativePath: 'q.md', content: '# Other\n\n```js\nconst x = 1;\nconst y = 2;\nconst z = 3;\n```\n\nDifferent prose entirely here now.' },
    ];
    const indexer = new Indexer({ ngramMin: 3, ngramMax: 8 });
    indexer.buildIndex(codeFiles);
    const shared = indexer.getSharedNgrams('p.md');
    const codeTags = shared.filter(ng => ng.tag === 'code');
    assert.ok(codeTags.length > 0, 'should detect shared code n-grams');
  });

  it('does not cross section boundaries', () => {
    const sectionFiles = [
      { relativePath: 's.md', content: '## Section A\n\nEnd of section A.\n\n## Section B\n\nStart of section B.' },
    ];
    const indexer = new Indexer({ ngramMin: 3, ngramMax: 5 });
    indexer.buildIndex(sectionFiles);
    const allNgrams = indexer.getAllNgramsForFile('s.md');
    const crossing = allNgrams.filter(ng =>
      ng.original.includes('section A') && ng.original.includes('section B')
    );
    assert.equal(crossing.length, 0, 'n-grams should not cross section boundaries');
  });
});
