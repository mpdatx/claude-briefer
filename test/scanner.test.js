import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { Scanner } from '../src/scanner.js';
import { mkdirSync, writeFileSync, rmSync, unlinkSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'simple');

describe('Scanner', () => {
  it('discovers markdown files matching glob', async () => {
    const scanner = new Scanner(FIXTURES, '**/*.md');
    await scanner.scan();
    const files = scanner.getFiles();
    assert.equal(files.length, 3);
    const names = files.map(f => f.relativePath).sort();
    assert.deepStrictEqual(names, ['guide.md', 'intro.md', 'reference.md']);
  });

  it('reads file content into memory', async () => {
    const scanner = new Scanner(FIXTURES, '**/*.md');
    await scanner.scan();
    const intro = scanner.getFile('intro.md');
    assert.ok(intro.content.includes('# Introduction'));
    assert.ok(intro.size > 0);
  });

  it('respects custom glob pattern', async () => {
    const scanner = new Scanner(FIXTURES, '**/intro.md');
    await scanner.scan();
    const files = scanner.getFiles();
    assert.equal(files.length, 1);
    assert.equal(files[0].relativePath, 'intro.md');
  });

  it('returns null for unknown file', async () => {
    const scanner = new Scanner(FIXTURES, '**/*.md');
    await scanner.scan();
    assert.equal(scanner.getFile('nonexistent.md'), null);
  });

  it('updates file content on write', async () => {
    const tmpDir = join(import.meta.dirname, 'fixtures', 'tmp-scanner');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'a.md'), '# Original');

    try {
      const scanner = new Scanner(tmpDir, '**/*.md');
      await scanner.scan();
      assert.ok(scanner.getFile('a.md').content.includes('# Original'));

      scanner.writeFile('a.md', '# Updated');
      assert.ok(scanner.getFile('a.md').content.includes('# Updated'));
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
