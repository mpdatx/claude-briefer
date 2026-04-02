import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Merger } from '../src/merger.js';

describe('Merger', () => {
  describe('keep-one', () => {
    it('removes content from non-keeper files', () => {
      const files = {
        'a.md': '# A\n\nShared content here.\n\nUnique to A.',
        'b.md': '# B\n\nShared content here.\n\nUnique to B.',
      };
      const merger = new Merger(files);
      const preview = merger.keepOne({
        content: 'Shared content here.',
        keepFile: 'a.md',
        removeFiles: ['b.md'],
      });

      assert.ok(preview['b.md'].after.includes('Unique to B'));
      assert.ok(!preview['b.md'].after.includes('Shared content here'));
      assert.ok(preview['a.md'] === undefined, 'keeper file should not change');
    });

    it('removes empty sections after content removal', () => {
      const files = {
        'a.md': '# A\n\n## Section\n\nShared content here.\n\n## Other\n\nKeep this.',
      };
      const merger = new Merger(files);
      const preview = merger.keepOne({
        content: 'Shared content here.',
        keepFile: 'b.md',
        removeFiles: ['a.md'],
      });

      assert.ok(!preview['a.md'].after.includes('## Section'), 'empty section heading should be removed');
      assert.ok(preview['a.md'].after.includes('## Other'));
    });
  });

  describe('consolidate', () => {
    it('moves content to target and adds reference', () => {
      const files = {
        'a.md': '# A\n\n## Setup\n\nShared setup instructions.\n\nMore A content.',
        'b.md': '# B\n\n## Setup\n\nShared setup instructions.\n\nMore B content.',
      };
      const merger = new Merger(files);
      const preview = merger.consolidate({
        content: 'Shared setup instructions.',
        sectionName: 'Setup',
        sourceFiles: ['a.md', 'b.md'],
        targetFile: 'shared.md',
      });

      assert.ok(preview['shared.md'].after.includes('Shared setup instructions'));
      assert.ok(preview['a.md'].after.includes('See [Setup](shared.md#setup)'));
      assert.ok(preview['b.md'].after.includes('See [Setup](shared.md#setup)'));
    });

    it('creates target file if it does not exist', () => {
      const files = {
        'a.md': '# A\n\nShared content.',
      };
      const merger = new Merger(files);
      const preview = merger.consolidate({
        content: 'Shared content.',
        sectionName: 'Shared',
        sourceFiles: ['a.md'],
        targetFile: 'new.md',
      });

      assert.ok('new.md' in preview);
      assert.ok(preview['new.md'].isNew);
      assert.ok(preview['new.md'].after.includes('Shared content'));
    });
  });

  describe('delete', () => {
    it('removes content from specified files', () => {
      const files = {
        'a.md': '# A\n\nRemove this line.\n\nKeep this.',
        'b.md': '# B\n\nRemove this line.\n\nKeep this too.',
      };
      const merger = new Merger(files);
      const preview = merger.deleteContent({
        content: 'Remove this line.',
        files: ['a.md', 'b.md'],
      });

      assert.ok(!preview['a.md'].after.includes('Remove this line'));
      assert.ok(preview['a.md'].after.includes('Keep this'));
      assert.ok(!preview['b.md'].after.includes('Remove this line'));
      assert.ok(preview['b.md'].after.includes('Keep this too'));
    });
  });

  describe('diff preview', () => {
    it('includes before and after for each changed file', () => {
      const files = {
        'a.md': '# A\n\nContent to remove.\n\nKeep.',
      };
      const merger = new Merger(files);
      const preview = merger.deleteContent({
        content: 'Content to remove.',
        files: ['a.md'],
      });

      assert.ok('before' in preview['a.md']);
      assert.ok('after' in preview['a.md']);
      assert.notEqual(preview['a.md'].before, preview['a.md'].after);
    });
  });
});
