# Claude Briefer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web-based tool that scans markdown files, detects redundant content via n-gram analysis, and provides a browser UI for reviewing and merging duplicates.

**Architecture:** Single-process Express server. Backend: file scanner, NLP indexer (markdown-it + natural), REST API. Frontend: vanilla HTML/JS/CSS with CodeMirror editor. All state in-memory.

**Tech Stack:** Node.js, Express, markdown-it, natural, CodeMirror 6, glob, chokidar

---

## File Structure

```
claude-briefer/
├── package.json
├── bin/
│   └── cli.js                  # CLI entry point, arg parsing, launches server
├── src/
│   ├── server.js               # Express app setup, static serving, route mounting
│   ├── scanner.js              # File discovery + reading + watching
│   ├── extractor.js            # Markdown AST → tagged text segments
│   ├── indexer.js              # N-gram generation, inverted index, redundancy scoring
│   └── merger.js               # Merge operations (keep-one, consolidate, delete) + diff preview
├── public/
│   ├── index.html              # Three-panel layout shell
│   ├── app.js                  # Main app logic, API calls, panel coordination
│   ├── editor.js               # CodeMirror setup + n-gram highlight integration
│   ├── panels.js               # File list panel + context/right panel rendering
│   └── style.css               # Minimal styling
└── test/
    ├── fixtures/
    │   ├── simple/             # Basic test corpus (3-4 small .md files with known overlaps)
    │   └── edge-cases/         # Code blocks, frontmatter, nested formatting
    ├── extractor.test.js
    ├── indexer.test.js
    ├── merger.test.js
    └── api.test.js
```

---

### Task 1: Project Scaffolding + CLI

**Files:**
- Create: `package.json`
- Create: `bin/cli.js`
- Create: `src/server.js`

- [ ] **Step 1: Initialize project**

```bash
cd /Users/mpd/claude/claude-briefer
npm init -y
```

Then edit `package.json`:

```json
{
  "name": "claude-briefer",
  "version": "0.1.0",
  "description": "Detect and remove redundant content across markdown files",
  "bin": {
    "claude-briefer": "./bin/cli.js"
  },
  "scripts": {
    "test": "node --test test/**/*.test.js",
    "start": "node bin/cli.js"
  },
  "type": "module"
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install express markdown-it natural glob chokidar open
npm install --save-dev supertest
```

- [ ] **Step 3: Write CLI entry point**

Create `bin/cli.js`:

```js
#!/usr/bin/env node

import { resolve } from 'path';
import { existsSync } from 'fs';
import { startServer } from '../src/server.js';

const args = process.argv.slice(2);

function parseArgs(args) {
  const opts = {
    dir: null,
    glob: '**/*.md',
    port: 3000,
    ngramMin: 3,
    ngramMax: 8,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--glob':
        opts.glob = args[++i];
        break;
      case '--port':
        opts.port = parseInt(args[++i], 10);
        break;
      case '--ngram-min':
        opts.ngramMin = parseInt(args[++i], 10);
        break;
      case '--ngram-max':
        opts.ngramMax = parseInt(args[++i], 10);
        break;
      default:
        if (!args[i].startsWith('--')) {
          opts.dir = resolve(args[i]);
        }
    }
  }

  return opts;
}

const opts = parseArgs(args);

if (!opts.dir) {
  console.error('Usage: claude-briefer <directory> [options]');
  console.error('');
  console.error('Options:');
  console.error('  --glob <pattern>     File pattern (default: "**/*.md")');
  console.error('  --port <number>      Server port (default: 3000)');
  console.error('  --ngram-min <n>      Min n-gram size (default: 3)');
  console.error('  --ngram-max <n>      Max n-gram size (default: 8)');
  process.exit(1);
}

if (!existsSync(opts.dir)) {
  console.error(`Directory not found: ${opts.dir}`);
  process.exit(1);
}

startServer(opts);
```

- [ ] **Step 4: Write minimal server**

Create `src/server.js`:

```js
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import open from 'open';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createApp(opts) {
  const app = express();
  app.use(express.json());
  app.use(express.static(join(__dirname, '..', 'public')));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', dir: opts.dir });
  });

  return app;
}

export async function startServer(opts) {
  const app = createApp(opts);

  app.listen(opts.port, () => {
    const url = `http://localhost:${opts.port}`;
    console.log(`Claude Briefer running at ${url}`);
    console.log(`Scanning: ${opts.dir} (${opts.glob})`);
    open(url);
  });
}
```

- [ ] **Step 5: Verify it runs**

```bash
mkdir -p /tmp/test-briefer && echo "# Test" > /tmp/test-briefer/test.md
node bin/cli.js /tmp/test-briefer --port 3001
```

Expected: prints "Claude Briefer running at http://localhost:3001", opens browser. Kill with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json bin/ src/server.js
git commit -m "feat: project scaffolding with CLI and Express server"
```

---

### Task 2: File Scanner

**Files:**
- Create: `src/scanner.js`
- Create: `test/fixtures/simple/intro.md`
- Create: `test/fixtures/simple/guide.md`
- Create: `test/fixtures/simple/reference.md`

- [ ] **Step 1: Create test fixtures**

Create `test/fixtures/simple/intro.md`:

```markdown
# Introduction

Welcome to the project. This guide will help you get started with installation and configuration.

## Getting Started

To install the project, run the following command:

\`\`\`bash
npm install my-project
\`\`\`

After installation, configure your environment variables.
```

Create `test/fixtures/simple/guide.md`:

```markdown
# User Guide

This guide will help you get started with installation and configuration.

## Installation

To install the project, run the following command:

\`\`\`bash
npm install my-project
\`\`\`

## Configuration

Set up your environment variables in a `.env` file.
```

Create `test/fixtures/simple/reference.md`:

```markdown
# API Reference

## Authentication

Configure your environment variables before making API calls.

## Endpoints

The API provides REST endpoints for all operations.
```

- [ ] **Step 2: Write scanner tests**

Create `test/scanner.test.js`:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- --test-name-pattern Scanner
```

Expected: FAIL — `scanner.js` doesn't exist.

- [ ] **Step 4: Implement scanner**

Create `src/scanner.js`:

```js
import { glob } from 'glob';
import { readFileSync, writeFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { watch } from 'chokidar';

export class Scanner {
  constructor(dir, pattern) {
    this.dir = dir;
    this.pattern = pattern;
    this.files = new Map();
    this.watcher = null;
    this.onChange = null;
  }

  async scan() {
    const matches = await glob(this.pattern, { cwd: this.dir, nodir: true });
    this.files.clear();

    for (const relPath of matches) {
      this._loadFile(relPath);
    }
  }

  _loadFile(relPath) {
    const absPath = join(this.dir, relPath);
    const content = readFileSync(absPath, 'utf-8');
    const stat = statSync(absPath);
    this.files.set(relPath, {
      relativePath: relPath,
      absolutePath: absPath,
      content,
      size: stat.size,
    });
  }

  getFiles() {
    return Array.from(this.files.values());
  }

  getFile(relPath) {
    return this.files.get(relPath) || null;
  }

  writeFile(relPath, content) {
    const absPath = join(this.dir, relPath);
    writeFileSync(absPath, content, 'utf-8');
    const stat = statSync(absPath);
    this.files.set(relPath, {
      relativePath: relPath,
      absolutePath: absPath,
      content,
      size: stat.size,
    });
  }

  startWatching(onChange) {
    this.onChange = onChange;
    this.watcher = watch(this.pattern, {
      cwd: this.dir,
      ignoreInitial: true,
    });

    this.watcher.on('change', (relPath) => {
      this._loadFile(relPath);
      if (this.onChange) this.onChange(relPath, 'change');
    });

    this.watcher.on('add', (relPath) => {
      this._loadFile(relPath);
      if (this.onChange) this.onChange(relPath, 'add');
    });

    this.watcher.on('unlink', (relPath) => {
      this.files.delete(relPath);
      if (this.onChange) this.onChange(relPath, 'unlink');
    });
  }

  stopWatching() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern Scanner
```

Expected: all 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scanner.js test/scanner.test.js test/fixtures/simple/
git commit -m "feat: file scanner with glob discovery and in-memory storage"
```

---

### Task 3: Markdown Text Extractor

**Files:**
- Create: `src/extractor.js`
- Create: `test/extractor.test.js`
- Create: `test/fixtures/edge-cases/formatting.md`
- Create: `test/fixtures/edge-cases/code-blocks.md`

- [ ] **Step 1: Create edge-case fixtures**

Create `test/fixtures/edge-cases/formatting.md`:

```markdown
# Getting **Started**

This is a [link to docs](https://example.com) with *emphasis* and ~~strikethrough~~.

## Items

- First item in the list
- Second **bold** item
- Third item with `inline code`

> This is a blockquote with **bold** text.

![Alt text for image](image.png)
```

Create `test/fixtures/edge-cases/code-blocks.md`:

````markdown
# Code Examples

Here is some prose before the code.

```javascript
function hello() {
  console.log("world");
}
```

And prose after the code.

```python
def greet():
    print("hello")
```
````

- [ ] **Step 2: Write extractor tests**

Create `test/extractor.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractSegments } from '../src/extractor.js';

describe('extractSegments', () => {
  it('extracts plain prose text', () => {
    const segments = extractSegments('# Hello\n\nThis is a paragraph.');
    const prose = segments.filter(s => s.tag === 'prose');
    assert.ok(prose.some(s => s.text === 'Hello'));
    assert.ok(prose.some(s => s.text === 'This is a paragraph.'));
  });

  it('strips inline markdown formatting', () => {
    const segments = extractSegments('This is **bold** and *italic* text.');
    const prose = segments.filter(s => s.tag === 'prose');
    const joined = prose.map(s => s.text).join('');
    assert.ok(joined.includes('bold'));
    assert.ok(joined.includes('italic'));
    assert.ok(!joined.includes('**'));
    assert.ok(!joined.includes('*'));
  });

  it('extracts link text, discards URL', () => {
    const segments = extractSegments('Click [here for docs](https://example.com).');
    const prose = segments.filter(s => s.tag === 'prose');
    const joined = prose.map(s => s.text).join('');
    assert.ok(joined.includes('here for docs'));
    assert.ok(!joined.includes('https://'));
  });

  it('extracts image alt text', () => {
    const segments = extractSegments('![Alt text for image](image.png)');
    const prose = segments.filter(s => s.tag === 'prose');
    const joined = prose.map(s => s.text).join('');
    assert.ok(joined.includes('Alt text for image'));
    assert.ok(!joined.includes('image.png'));
  });

  it('extracts fenced code blocks as code-tagged segments', () => {
    const md = '# Title\n\n```js\nconst x = 1;\n```\n\nAfter.';
    const segments = extractSegments(md);
    const code = segments.filter(s => s.tag === 'code');
    assert.equal(code.length, 1);
    assert.ok(code[0].text.includes('const x = 1;'));
  });

  it('extracts inline code as code-tagged', () => {
    const segments = extractSegments('Use `npm install` to install.');
    const code = segments.filter(s => s.tag === 'code');
    assert.ok(code.some(s => s.text === 'npm install'));
  });

  it('does not concatenate text across structural boundaries', () => {
    const md = '- Item one\n- Item two\n\nParagraph here.';
    const segments = extractSegments(md);
    const prose = segments.filter(s => s.tag === 'prose');
    const texts = prose.map(s => s.text);
    assert.ok(!texts.some(s => s.includes('Item one') && s.includes('Item two')));
    assert.ok(!texts.some(s => s.includes('Item two') && s.includes('Paragraph')));
  });

  it('preserves line numbers for each segment', () => {
    const md = '# Title\n\nParagraph on line 3.\n\n```js\ncode\n```';
    const segments = extractSegments(md);
    for (const seg of segments) {
      assert.ok(typeof seg.line === 'number', `segment "${seg.text}" missing line number`);
      assert.ok(seg.line >= 1);
    }
  });

  it('extracts blockquote inner text as prose', () => {
    const segments = extractSegments('> This is quoted **bold** text.');
    const prose = segments.filter(s => s.tag === 'prose');
    const joined = prose.map(s => s.text).join('');
    assert.ok(joined.includes('This is quoted'));
    assert.ok(joined.includes('bold'));
  });

  it('handles strikethrough', () => {
    const segments = extractSegments('This is ~~deleted~~ text.');
    const prose = segments.filter(s => s.tag === 'prose');
    const joined = prose.map(s => s.text).join('');
    assert.ok(joined.includes('deleted'));
    assert.ok(!joined.includes('~~'));
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test -- --test-name-pattern extractSegments
```

Expected: FAIL — `extractor.js` doesn't exist.

- [ ] **Step 4: Implement extractor**

Create `src/extractor.js`:

```js
import MarkdownIt from 'markdown-it';
import markdownItStrikethrough from 'markdown-it/lib/rules_inline/strikethrough.mjs';

const md = new MarkdownIt({ html: true });

export function extractSegments(markdown) {
  const tokens = md.parse(markdown, {});
  const segments = [];
  collectSegments(tokens, segments, null);
  return segments;
}

function collectSegments(tokens, segments, parentTag) {
  for (const token of tokens) {
    const line = token.map ? token.map[0] + 1 : null;

    if (token.type === 'fence') {
      segments.push({
        text: token.content.trimEnd(),
        tag: 'code',
        line: line,
        blockType: 'fence',
      });
      continue;
    }

    if (token.type === 'code_block') {
      segments.push({
        text: token.content.trimEnd(),
        tag: 'code',
        line: line,
        blockType: 'code_block',
      });
      continue;
    }

    if (token.type === 'inline') {
      const extracted = extractInlineSegments(token.children, line);
      for (const seg of extracted) {
        segments.push(seg);
      }
      continue;
    }

    if (token.children) {
      collectSegments(token.children, segments, parentTag);
    }
  }
}

function extractInlineSegments(children, line) {
  const segments = [];
  let currentText = '';
  let currentTag = 'prose';

  function flush() {
    const trimmed = currentText.trim();
    if (trimmed) {
      segments.push({ text: trimmed, tag: currentTag, line: line });
    }
    currentText = '';
  }

  let inCode = false;

  for (const child of children) {
    if (child.type === 'code_inline') {
      flush();
      segments.push({ text: child.content, tag: 'code', line: line });
      continue;
    }

    if (child.type === 'softbreak' || child.type === 'hardbreak') {
      currentText += ' ';
      continue;
    }

    if (child.type === 'text') {
      currentText += child.content;
      continue;
    }

    if (child.type === 'image') {
      if (child.children) {
        for (const imgChild of child.children) {
          if (imgChild.type === 'text') {
            currentText += imgChild.content;
          }
        }
      }
      continue;
    }

    // Skip open/close tags for formatting (strong, em, s, etc.)
    // Their text content children are handled by the text case above.
  }

  flush();
  return segments;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern extractSegments
```

Expected: all 10 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/extractor.js test/extractor.test.js test/fixtures/edge-cases/
git commit -m "feat: markdown-aware text extractor with tag-based segmentation"
```

---

### Task 4: N-gram Indexer

**Files:**
- Create: `src/indexer.js`
- Create: `test/indexer.test.js`

- [ ] **Step 1: Write indexer tests**

Create `test/indexer.test.js`:

```js
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
    const shared = indexer.getSharedNgrams('a.md');
    // The shared phrase is long; overlapping shorter n-grams should be merged
    // into fewer, longer spans rather than many short overlapping ones
    const spans = indexer.getMergedSpans('a.md');
    assert.ok(spans.length > 0);
    // No two spans should overlap in the same file
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
    // n-grams should not span "End of section A" + "Start of section B"
    const allNgrams = indexer.getAllNgramsForFile('s.md');
    const crossing = allNgrams.filter(ng =>
      ng.original.includes('section A') && ng.original.includes('section B')
    );
    assert.equal(crossing.length, 0, 'n-grams should not cross section boundaries');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --test-name-pattern Indexer
```

Expected: FAIL — `indexer.js` doesn't exist.

- [ ] **Step 3: Implement indexer**

Create `src/indexer.js`:

```js
import { PorterStemmer, WordTokenizer } from 'natural';
import { extractSegments } from './extractor.js';

const tokenizer = new WordTokenizer();

export class Indexer {
  constructor(opts = {}) {
    this.ngramMin = opts.ngramMin || 3;
    this.ngramMax = opts.ngramMax || 8;
    // Map: stemmedNgram -> [{ file, line, tag, original }]
    this.index = new Map();
    // Map: file -> [{ stemmed, original, tag, line, startOffset, endOffset }]
    this.fileNgrams = new Map();
    // Map: file -> segments
    this.fileSegments = new Map();
  }

  buildIndex(files) {
    this.index.clear();
    this.fileNgrams.clear();
    this.fileSegments.clear();

    for (const file of files) {
      const segments = extractSegments(file.content);
      this.fileSegments.set(file.relativePath, segments);
      const ngrams = this._extractNgrams(segments, file.relativePath);
      this.fileNgrams.set(file.relativePath, ngrams);

      for (const ng of ngrams) {
        if (!this.index.has(ng.stemmed)) {
          this.index.set(ng.stemmed, []);
        }
        this.index.get(ng.stemmed).push({
          file: file.relativePath,
          line: ng.line,
          tag: ng.tag,
          original: ng.original,
        });
      }
    }
  }

  _extractNgrams(segments, file) {
    const allNgrams = [];

    for (const segment of segments) {
      const words = tokenizer.tokenize(segment.text);
      if (!words || words.length < this.ngramMin) continue;

      const stemmed = words.map(w => PorterStemmer.stem(w.toLowerCase()));

      for (let n = this.ngramMin; n <= this.ngramMax; n++) {
        for (let i = 0; i <= words.length - n; i++) {
          const stemmedNgram = stemmed.slice(i, i + n).join(' ');
          const originalNgram = words.slice(i, i + n).join(' ');

          // Compute character offsets within the segment text
          const beforeWords = words.slice(0, i);
          const startOffset = beforeWords.length === 0
            ? segment.text.indexOf(words[0])
            : segment.text.indexOf(words[i]);
          const lastWord = words[i + n - 1];
          const endOffset = segment.text.indexOf(lastWord, startOffset) + lastWord.length;

          allNgrams.push({
            stemmed: stemmedNgram,
            original: originalNgram,
            tag: segment.tag,
            line: segment.line,
            startOffset,
            endOffset,
            segmentText: segment.text,
          });
        }
      }
    }

    return allNgrams;
  }

  getSharedNgrams(filePath) {
    const ngrams = this.fileNgrams.get(filePath);
    if (!ngrams) return [];

    const seen = new Set();
    const shared = [];

    for (const ng of ngrams) {
      if (seen.has(ng.stemmed)) continue;
      const locations = this.index.get(ng.stemmed);
      if (!locations || locations.length < 2) continue;

      const otherFiles = locations.filter(loc => loc.file !== filePath);
      if (otherFiles.length === 0) continue;

      seen.add(ng.stemmed);
      shared.push({
        stemmed: ng.stemmed,
        original: ng.original,
        tag: ng.tag,
        line: ng.line,
        count: locations.length,
        locations,
      });
    }

    return shared;
  }

  getAllNgramsForFile(filePath) {
    return this.fileNgrams.get(filePath) || [];
  }

  getNgramLocations(stemmedNgram) {
    return this.index.get(stemmedNgram) || [];
  }

  getMergedSpans(filePath) {
    const ngrams = this.fileNgrams.get(filePath);
    if (!ngrams) return [];

    // Filter to only shared n-grams
    const shared = ngrams.filter(ng => {
      const locs = this.index.get(ng.stemmed);
      if (!locs || locs.length < 2) return false;
      return locs.some(loc => loc.file !== filePath);
    });

    if (shared.length === 0) return [];

    // Sort by startOffset
    const sorted = [...shared].sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);

    // Merge overlapping spans
    const merged = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      const curr = sorted[i];
      if (curr.startOffset <= last.endOffset) {
        // Extend the span
        if (curr.endOffset > last.endOffset) {
          last.endOffset = curr.endOffset;
          last.original = last.segmentText.slice(last.startOffset, last.endOffset);
        }
      } else {
        merged.push({ ...curr });
      }
    }

    return merged.map(s => ({
      startOffset: s.startOffset,
      endOffset: s.endOffset,
      line: s.line,
      tag: s.tag,
      original: s.original,
    }));
  }

  getRedundancyReport() {
    const report = [];

    for (const [filePath, ngrams] of this.fileNgrams) {
      let score = 0;
      const seen = new Set();

      for (const ng of ngrams) {
        if (seen.has(ng.stemmed)) continue;
        const locs = this.index.get(ng.stemmed);
        if (!locs || locs.length < 2) continue;
        if (!locs.some(loc => loc.file !== filePath)) continue;

        seen.add(ng.stemmed);
        const ngramLen = ng.stemmed.split(' ').length;
        score += ngramLen * ngramLen * locs.length;
      }

      const segments = this.fileSegments.get(filePath) || [];
      const totalLen = segments.reduce((sum, s) => sum + s.text.length, 0);
      const normalizedScore = totalLen > 0 ? score / totalLen : 0;

      report.push({
        file: filePath,
        score: normalizedScore,
        totalLength: totalLen,
        rawScore: score,
      });
    }

    report.sort((a, b) => b.score - a.score);
    return report;
  }

  reindexFile(filePath, content) {
    // Remove old entries for this file from the inverted index
    const oldNgrams = this.fileNgrams.get(filePath) || [];
    for (const ng of oldNgrams) {
      const locs = this.index.get(ng.stemmed);
      if (locs) {
        const filtered = locs.filter(loc => loc.file !== filePath);
        if (filtered.length === 0) {
          this.index.delete(ng.stemmed);
        } else {
          this.index.set(ng.stemmed, filtered);
        }
      }
    }

    // Re-extract and re-index
    const segments = extractSegments(content);
    this.fileSegments.set(filePath, segments);
    const ngrams = this._extractNgrams(segments, filePath);
    this.fileNgrams.set(filePath, ngrams);

    for (const ng of ngrams) {
      if (!this.index.has(ng.stemmed)) {
        this.index.set(ng.stemmed, []);
      }
      this.index.get(ng.stemmed).push({
        file: filePath,
        line: ng.line,
        tag: ng.tag,
        original: ng.original,
      });
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern Indexer
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/indexer.js test/indexer.test.js
git commit -m "feat: n-gram indexer with stemming, redundancy scoring, and span merging"
```

---

### Task 5: Merge Operations

**Files:**
- Create: `src/merger.js`
- Create: `test/merger.test.js`

- [ ] **Step 1: Write merger tests**

Create `test/merger.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --test-name-pattern Merger
```

Expected: FAIL — `merger.js` doesn't exist.

- [ ] **Step 3: Implement merger**

Create `src/merger.js`:

```js
export class Merger {
  constructor(files) {
    // files: { [relativePath]: content string }
    this.files = { ...files };
  }

  keepOne({ content, keepFile, removeFiles }) {
    const preview = {};

    for (const filePath of removeFiles) {
      const original = this.files[filePath];
      if (!original) continue;

      let modified = this._removeContent(original, content);
      modified = this._cleanEmptySections(modified);

      preview[filePath] = {
        before: original,
        after: modified,
      };
    }

    return preview;
  }

  consolidate({ content, sectionName, sourceFiles, targetFile }) {
    const preview = {};
    const slug = sectionName.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '');
    const reference = `> See [${sectionName}](${targetFile}#${slug})`;

    // Build target file content
    const existingTarget = this.files[targetFile];
    let targetContent;
    if (existingTarget) {
      targetContent = existingTarget.trimEnd() + '\n\n## ' + sectionName + '\n\n' + content + '\n';
      preview[targetFile] = {
        before: existingTarget,
        after: targetContent,
        isNew: false,
      };
    } else {
      targetContent = '# Shared\n\n## ' + sectionName + '\n\n' + content + '\n';
      preview[targetFile] = {
        before: '',
        after: targetContent,
        isNew: true,
      };
    }

    // Replace content in source files with reference
    for (const filePath of sourceFiles) {
      const original = this.files[filePath];
      if (!original) continue;

      const modified = original.replace(content, reference);

      preview[filePath] = {
        before: original,
        after: modified,
      };
    }

    return preview;
  }

  deleteContent({ content, files }) {
    const preview = {};

    for (const filePath of files) {
      const original = this.files[filePath];
      if (!original) continue;

      let modified = this._removeContent(original, content);
      modified = this._cleanEmptySections(modified);

      preview[filePath] = {
        before: original,
        after: modified,
      };
    }

    return preview;
  }

  _removeContent(text, content) {
    // Remove the content and clean up extra blank lines
    const result = text.replace(content, '');
    return result.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  _cleanEmptySections(text) {
    // Remove section headings that have no content before the next heading or EOF
    const lines = text.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
      const headingMatch = lines[i].match(/^(#{1,6})\s+/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        // Look ahead: is there any non-empty, non-heading content before next heading of same/higher level?
        let hasContent = false;
        let j = i + 1;
        while (j < lines.length) {
          const nextHeading = lines[j].match(/^(#{1,6})\s+/);
          if (nextHeading && nextHeading[1].length <= level) break;
          if (lines[j].trim() !== '') {
            hasContent = true;
            break;
          }
          j++;
        }
        if (!hasContent) {
          // Skip this empty heading
          i++;
          // Skip blank lines after it
          while (i < lines.length && lines[i].trim() === '') i++;
          continue;
        }
      }
      result.push(lines[i]);
      i++;
    }

    return result.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern Merger
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/merger.js test/merger.test.js
git commit -m "feat: merge operations with keep-one, consolidate, delete, and diff preview"
```

---

### Task 6: REST API Routes

**Files:**
- Modify: `src/server.js`
- Create: `test/api.test.js`

- [ ] **Step 1: Write API tests**

Create `test/api.test.js`:

```js
import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createApp } from '../src/server.js';
import { join } from 'path';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'simple');

describe('API', () => {
  let app;

  before(async () => {
    app = await createApp({
      dir: FIXTURES,
      glob: '**/*.md',
      port: 0,
      ngramMin: 3,
      ngramMax: 8,
    });
  });

  describe('GET /api/files', () => {
    it('returns list of files with metadata', async () => {
      const res = await request(app).get('/api/files');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 3);
      const file = res.body.find(f => f.path === 'intro.md');
      assert.ok(file);
      assert.ok(typeof file.size === 'number');
      assert.ok(typeof file.redundancyScore === 'number');
    });
  });

  describe('GET /api/files/:path', () => {
    it('returns file content', async () => {
      const res = await request(app).get('/api/files/intro.md');
      assert.equal(res.status, 200);
      assert.ok(res.body.content.includes('# Introduction'));
    });

    it('returns 404 for unknown file', async () => {
      const res = await request(app).get('/api/files/nope.md');
      assert.equal(res.status, 404);
    });
  });

  describe('GET /api/ngrams/:path', () => {
    it('returns shared n-grams for a file', async () => {
      const res = await request(app).get('/api/ngrams/intro.md');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.ngrams));
      assert.ok(Array.isArray(res.body.spans));
    });
  });

  describe('GET /api/ngrams/:path with ngram query', () => {
    it('returns locations for a specific n-gram', async () => {
      // First get the n-grams to find a valid stemmed key
      const ngramRes = await request(app).get('/api/ngrams/intro.md');
      if (ngramRes.body.ngrams.length > 0) {
        const stemmed = ngramRes.body.ngrams[0].stemmed;
        const res = await request(app)
          .get(`/api/ngrams/intro.md`)
          .query({ ngram: stemmed });
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.body.locations));
        assert.ok(res.body.locations.length >= 2);
      }
    });
  });

  describe('GET /api/redundancy', () => {
    it('returns redundancy report sorted by score', async () => {
      const res = await request(app).get('/api/redundancy');
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      // Should be sorted descending by score
      for (let i = 1; i < res.body.length; i++) {
        assert.ok(res.body[i].score <= res.body[i - 1].score);
      }
    });
  });

  describe('POST /api/merge/delete', () => {
    it('returns diff preview without applying', async () => {
      // Get a shared n-gram first
      const ngramRes = await request(app).get('/api/ngrams/intro.md');
      if (ngramRes.body.ngrams.length > 0) {
        const original = ngramRes.body.ngrams[0].original;
        const res = await request(app)
          .post('/api/merge/delete')
          .send({
            content: original,
            files: ['intro.md'],
            apply: false,
          });
        assert.equal(res.status, 200);
        assert.ok(res.body.preview);
        assert.ok('intro.md' in res.body.preview);
        assert.ok(res.body.preview['intro.md'].before);
        assert.ok(res.body.preview['intro.md'].after);
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --test-name-pattern API
```

Expected: FAIL — `createApp` doesn't accept these args yet and routes don't exist.

- [ ] **Step 3: Update server with full API routes**

Replace `src/server.js`:

```js
import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import open from 'open';
import { Scanner } from './scanner.js';
import { Indexer } from './indexer.js';
import { Merger } from './merger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function createApp(opts) {
  const app = express();
  app.use(express.json());
  app.use(express.static(join(__dirname, '..', 'public')));

  const scanner = new Scanner(opts.dir, opts.glob);
  await scanner.scan();

  const indexer = new Indexer({
    ngramMin: opts.ngramMin,
    ngramMax: opts.ngramMax,
  });
  indexer.buildIndex(scanner.getFiles());

  // Watch for external changes and re-index
  scanner.startWatching((relPath, event) => {
    if (event === 'unlink') {
      indexer.buildIndex(scanner.getFiles());
    } else {
      const file = scanner.getFile(relPath);
      if (file) indexer.reindexFile(relPath, file.content);
    }
  });

  // --- File routes ---

  app.get('/api/files', (req, res) => {
    const report = indexer.getRedundancyReport();
    const scoreMap = new Map(report.map(r => [r.file, r.score]));

    const files = scanner.getFiles().map(f => ({
      path: f.relativePath,
      size: f.size,
      redundancyScore: scoreMap.get(f.relativePath) || 0,
    }));

    files.sort((a, b) => b.redundancyScore - a.redundancyScore);
    res.json(files);
  });

  app.get('/api/files/:path(*)', (req, res) => {
    const file = scanner.getFile(req.params.path);
    if (!file) return res.status(404).json({ error: 'File not found' });
    res.json({ path: file.relativePath, content: file.content, size: file.size });
  });

  app.put('/api/files/:path(*)', (req, res) => {
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content required' });
    }
    const file = scanner.getFile(req.params.path);
    if (!file) return res.status(404).json({ error: 'File not found' });

    scanner.writeFile(req.params.path, content);
    indexer.reindexFile(req.params.path, content);
    res.json({ ok: true });
  });

  // --- N-gram routes ---

  app.get('/api/ngrams/:path(*)', (req, res) => {
    const filePath = req.params.path;
    const file = scanner.getFile(filePath);
    if (!file) return res.status(404).json({ error: 'File not found' });

    // If ?ngram= is provided, return locations for that specific n-gram
    if (req.query.ngram) {
      const locations = indexer.getNgramLocations(req.query.ngram);
      return res.json({ ngram: req.query.ngram, locations });
    }

    const ngrams = indexer.getSharedNgrams(filePath);
    const spans = indexer.getMergedSpans(filePath);
    res.json({ ngrams, spans });
  });

  app.get('/api/redundancy', (req, res) => {
    res.json(indexer.getRedundancyReport());
  });

  // --- Merge routes ---

  function getFileContents() {
    const contents = {};
    for (const f of scanner.getFiles()) {
      contents[f.relativePath] = f.content;
    }
    return contents;
  }

  app.post('/api/merge/keep-one', (req, res) => {
    const { content, keepFile, removeFiles, apply } = req.body;
    const merger = new Merger(getFileContents());
    const preview = merger.keepOne({ content, keepFile, removeFiles });

    if (apply) {
      for (const [filePath, changes] of Object.entries(preview)) {
        scanner.writeFile(filePath, changes.after);
        indexer.reindexFile(filePath, changes.after);
      }
    }

    res.json({ preview });
  });

  app.post('/api/merge/consolidate', (req, res) => {
    const { content, sectionName, sourceFiles, targetFile, apply } = req.body;
    const merger = new Merger(getFileContents());
    const preview = merger.consolidate({ content, sectionName, sourceFiles, targetFile });

    if (apply) {
      for (const [filePath, changes] of Object.entries(preview)) {
        scanner.writeFile(filePath, changes.after);
        indexer.reindexFile(filePath, changes.after);
      }
    }

    res.json({ preview });
  });

  app.post('/api/merge/delete', (req, res) => {
    const { content, files, apply } = req.body;
    const merger = new Merger(getFileContents());
    const preview = merger.deleteContent({ content, files });

    if (apply) {
      for (const [filePath, changes] of Object.entries(preview)) {
        scanner.writeFile(filePath, changes.after);
        indexer.reindexFile(filePath, changes.after);
      }
    }

    res.json({ preview });
  });

  return app;
}

export async function startServer(opts) {
  const app = await createApp(opts);

  app.listen(opts.port, () => {
    const url = `http://localhost:${opts.port}`;
    console.log(`Claude Briefer running at ${url}`);
    console.log(`Scanning: ${opts.dir} (${opts.glob})`);
    open(url);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern API
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.js test/api.test.js
git commit -m "feat: REST API routes for files, n-grams, redundancy, and merges"
```

---

### Task 7: Frontend — HTML Shell + Styles

**Files:**
- Create: `public/index.html`
- Create: `public/style.css`

- [ ] **Step 1: Create HTML shell**

Create `public/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Briefer</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header id="topbar">
    <span id="dir-info"></span>
    <div id="controls">
      <label>
        Highlight:
        <select id="tag-filter">
          <option value="both">Both</option>
          <option value="prose">Prose only</option>
          <option value="code">Code only</option>
        </select>
      </label>
      <label>
        Min occurrences:
        <input type="range" id="min-occurrences" min="2" max="10" value="2">
        <span id="min-occ-value">2</span>
      </label>
    </div>
  </header>
  <main id="panels">
    <aside id="file-list">
      <input type="text" id="file-search" placeholder="Filter files...">
      <ul id="files"></ul>
    </aside>
    <section id="editor-panel">
      <div id="editor-toolbar">
        <span id="current-file"></span>
        <button id="save-btn" disabled>Save to disk</button>
      </div>
      <div id="editor"></div>
    </section>
    <aside id="context-panel">
      <div id="context-content">
        <p class="placeholder">Select a file to view redundancy info.</p>
      </div>
    </aside>
  </main>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/codemirror.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/codemirror.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/mode/markdown/markdown.min.js"></script>
  <script src="app.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 2: Create styles**

Create `public/style.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #1a1a2e;
  color: #e0e0e0;
}

#topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #16213e;
  border-bottom: 1px solid #0f3460;
  font-size: 13px;
}

#controls {
  display: flex;
  gap: 16px;
  align-items: center;
}

#controls label { display: flex; align-items: center; gap: 6px; }
#controls select, #controls input[type="range"] { cursor: pointer; }

#panels {
  flex: 1;
  display: flex;
  overflow: hidden;
}

#file-list {
  width: 240px;
  border-right: 1px solid #0f3460;
  display: flex;
  flex-direction: column;
  background: #16213e;
}

#file-search {
  padding: 8px;
  border: none;
  border-bottom: 1px solid #0f3460;
  background: #1a1a2e;
  color: #e0e0e0;
  font-size: 13px;
  outline: none;
}

#files {
  list-style: none;
  overflow-y: auto;
  flex: 1;
}

#files li {
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid #0f3460;
  font-size: 13px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

#files li:hover { background: #1a1a3e; }
#files li.active { background: #0f3460; }

.redundancy-bar {
  width: 40px;
  height: 6px;
  background: #333;
  border-radius: 3px;
  overflow: hidden;
}

.redundancy-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: #e94560;
}

#editor-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

#editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #16213e;
  border-bottom: 1px solid #0f3460;
  font-size: 13px;
}

#save-btn {
  padding: 4px 12px;
  background: #0f3460;
  color: #e0e0e0;
  border: 1px solid #533483;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

#save-btn:disabled { opacity: 0.4; cursor: default; }
#save-btn:not(:disabled):hover { background: #533483; }

#editor {
  flex: 1;
  overflow: hidden;
}

#editor .CodeMirror {
  height: 100%;
  background: #1a1a2e;
  color: #e0e0e0;
  font-size: 14px;
}

#editor .CodeMirror-gutters {
  background: #16213e;
  border-right: 1px solid #0f3460;
}

#context-panel {
  width: 320px;
  border-left: 1px solid #0f3460;
  overflow-y: auto;
  background: #16213e;
  font-size: 13px;
}

#context-content {
  padding: 12px;
}

.placeholder {
  color: #666;
  font-style: italic;
  text-align: center;
  padding: 24px;
}

.ngram-highlight {
  background: rgba(233, 69, 96, 0.25);
  border-radius: 2px;
  cursor: pointer;
}

.ngram-highlight-strong {
  background: rgba(233, 69, 96, 0.5);
}

.ngram-highlight-max {
  background: rgba(233, 69, 96, 0.75);
}

.occurrence {
  padding: 8px;
  margin-bottom: 8px;
  background: #1a1a2e;
  border-radius: 4px;
  border: 1px solid #0f3460;
}

.occurrence-file {
  font-weight: bold;
  color: #533483;
  margin-bottom: 4px;
}

.occurrence-context {
  font-family: monospace;
  font-size: 12px;
  white-space: pre-wrap;
  color: #aaa;
  margin-bottom: 8px;
}

.occurrence-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.occurrence-actions button {
  padding: 3px 8px;
  font-size: 11px;
  background: #0f3460;
  color: #e0e0e0;
  border: 1px solid #533483;
  border-radius: 3px;
  cursor: pointer;
}

.occurrence-actions button:hover { background: #533483; }

.overlap-summary {
  margin-bottom: 12px;
  padding: 8px;
  background: #1a1a2e;
  border-radius: 4px;
  border: 1px solid #0f3460;
}

.overlap-summary h4 { margin-bottom: 4px; color: #e94560; }

.diff-preview {
  background: #1a1a2e;
  padding: 12px;
  border-radius: 4px;
  margin: 8px 0;
  font-family: monospace;
  font-size: 12px;
  white-space: pre-wrap;
  max-height: 300px;
  overflow-y: auto;
}

.diff-removed { color: #e94560; }
.diff-added { color: #4ecca3; }

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: #16213e;
  border: 1px solid #0f3460;
  border-radius: 8px;
  padding: 20px;
  max-width: 600px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
}

.modal h3 { margin-bottom: 12px; }
.modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.modal-actions button { padding: 6px 16px; border-radius: 4px; cursor: pointer; border: 1px solid #533483; }
.btn-confirm { background: #4ecca3; color: #1a1a2e; }
.btn-cancel { background: #0f3460; color: #e0e0e0; }
```

- [ ] **Step 3: Verify HTML loads**

```bash
node -e "
import('./src/server.js').then(async m => {
  const app = await m.createApp({ dir: 'test/fixtures/simple', glob: '**/*.md', port: 0, ngramMin: 3, ngramMax: 8 });
  const server = app.listen(3099, () => {
    fetch('http://localhost:3099/').then(r => { console.log('Status:', r.status); server.close(); });
  });
});
"
```

Expected: `Status: 200`

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/style.css
git commit -m "feat: frontend HTML shell and CSS styles"
```

---

### Task 8: Frontend — App Logic + Editor

**Files:**
- Create: `public/app.js`
- Create: `public/editor.js`
- Create: `public/panels.js`

- [ ] **Step 1: Create editor module**

Create `public/editor.js`:

```js
let cm = null;
let highlights = [];
let onNgramClick = null;

export function initEditor(container, { onContentChange, onNgramClicked }) {
  onNgramClick = onNgramClicked;
  cm = CodeMirror(container, {
    mode: 'markdown',
    lineNumbers: true,
    lineWrapping: true,
    theme: 'default',
  });

  cm.on('change', () => {
    if (onContentChange) onContentChange(cm.getValue());
  });

  return cm;
}

export function setContent(text) {
  cm.setValue(text);
  clearHighlights();
}

export function getContent() {
  return cm.getValue();
}

export function clearHighlights() {
  for (const mark of highlights) {
    mark.clear();
  }
  highlights = [];
}

export function applyHighlights(spans, opts = {}) {
  clearHighlights();

  const text = cm.getValue();
  const lines = text.split('\n');

  for (const span of spans) {
    // Find the span in the document by searching near its reported line
    const searchStart = Math.max(0, (span.line || 1) - 2);
    const searchText = span.original;

    // Search for the text in the document
    let found = false;
    for (let lineIdx = searchStart; lineIdx < lines.length && !found; lineIdx++) {
      const lineText = lines[lineIdx];
      let charIdx = lineText.indexOf(searchText);

      // Also try multi-line search by joining lines
      if (charIdx === -1) {
        const joinedFromHere = lines.slice(lineIdx, lineIdx + 5).join('\n');
        const multiIdx = joinedFromHere.indexOf(searchText);
        if (multiIdx !== -1) {
          // Calculate from/to positions across lines
          const from = posFromOffset(lines, lineIdx, multiIdx);
          const to = posFromOffsetEnd(lines, lineIdx, multiIdx + searchText.length);
          const cssClass = getHighlightClass(span.count, opts.maxCount);
          const mark = cm.markText(from, to, {
            className: cssClass,
            attributes: { 'data-ngram': span.stemmed || '' },
          });
          highlights.push(mark);
          found = true;
        }
      } else {
        const from = { line: lineIdx, ch: charIdx };
        const to = { line: lineIdx, ch: charIdx + searchText.length };
        const cssClass = getHighlightClass(span.count, opts.maxCount);
        const mark = cm.markText(from, to, {
          className: cssClass,
          attributes: { 'data-ngram': span.stemmed || '' },
        });
        highlights.push(mark);
        found = true;
      }
    }
  }

  // Add click handler for highlights
  cm.getWrapperElement().onclick = (e) => {
    const target = e.target;
    if (target.classList.contains('ngram-highlight') ||
        target.classList.contains('ngram-highlight-strong') ||
        target.classList.contains('ngram-highlight-max')) {
      const ngram = target.getAttribute('data-ngram');
      if (ngram && onNgramClick) onNgramClick(ngram);
    }
  };
}

function getHighlightClass(count, maxCount) {
  if (!count || !maxCount || maxCount <= 2) return 'ngram-highlight';
  const ratio = count / maxCount;
  if (ratio > 0.7) return 'ngram-highlight-max';
  if (ratio > 0.4) return 'ngram-highlight-strong';
  return 'ngram-highlight';
}

function posFromOffset(lines, startLine, offset) {
  let remaining = offset;
  for (let i = startLine; i < lines.length; i++) {
    const lineLen = lines[i].length + 1; // +1 for newline
    if (remaining <= lines[i].length) {
      return { line: i, ch: remaining };
    }
    remaining -= lineLen;
  }
  return { line: lines.length - 1, ch: lines[lines.length - 1].length };
}

function posFromOffsetEnd(lines, startLine, offset) {
  return posFromOffset(lines, startLine, offset);
}
```

- [ ] **Step 2: Create panels module**

Create `public/panels.js`:

```js
export function renderFileList(files, { onSelect, activeFile, filter }) {
  const ul = document.getElementById('files');
  ul.innerHTML = '';

  const maxScore = Math.max(...files.map(f => f.redundancyScore), 0.01);
  const filtered = filter
    ? files.filter(f => f.path.toLowerCase().includes(filter.toLowerCase()))
    : files;

  for (const file of filtered) {
    const li = document.createElement('li');
    if (file.path === activeFile) li.classList.add('active');
    li.onclick = () => onSelect(file.path);

    const name = document.createElement('span');
    name.textContent = file.path;

    const bar = document.createElement('div');
    bar.className = 'redundancy-bar';
    const fill = document.createElement('div');
    fill.className = 'redundancy-bar-fill';
    fill.style.width = `${Math.min(100, (file.redundancyScore / maxScore) * 100)}%`;
    bar.appendChild(fill);

    li.appendChild(name);
    li.appendChild(bar);
    ul.appendChild(li);
  }
}

export function renderRedundancyOverview(ngrams, filePath) {
  const container = document.getElementById('context-content');

  if (!ngrams || ngrams.length === 0) {
    container.innerHTML = '<p class="placeholder">No redundant content detected in this file.</p>';
    return;
  }

  // Group by overlapping files
  const fileOverlaps = new Map();
  for (const ng of ngrams) {
    for (const loc of ng.locations) {
      if (loc.file === filePath) continue;
      if (!fileOverlaps.has(loc.file)) {
        fileOverlaps.set(loc.file, { count: 0, ngrams: [] });
      }
      const entry = fileOverlaps.get(loc.file);
      entry.count++;
      if (entry.ngrams.length < 3) {
        entry.ngrams.push(ng.original);
      }
    }
  }

  let html = '<h3>Redundancy Overview</h3>';
  const sorted = [...fileOverlaps.entries()].sort((a, b) => b[1].count - a[1].count);

  for (const [file, data] of sorted) {
    html += `
      <div class="overlap-summary">
        <h4>${file}</h4>
        <p>${data.count} shared n-gram(s)</p>
        <p style="color:#888;font-size:12px">${data.ngrams.map(n => `"${n}"`).join(', ')}${data.count > 3 ? '...' : ''}</p>
      </div>`;
  }

  container.innerHTML = html;
}

export function renderNgramOccurrences(ngram, locations, currentFile, { onKeepOne, onDelete, onConsolidate }) {
  const container = document.getElementById('context-content');

  let html = `<h3>N-gram occurrences</h3><p style="margin-bottom:12px;color:#888;font-size:12px">"${ngram}"</p>`;

  for (const loc of locations) {
    const isCurrent = loc.file === currentFile;
    html += `
      <div class="occurrence">
        <div class="occurrence-file">${loc.file}${isCurrent ? ' (current)' : ''}</div>
        <div class="occurrence-context">${escapeHtml(loc.original || '')}</div>
        <div class="occurrence-actions">
          <button data-action="keep" data-file="${loc.file}">Keep here, remove others</button>
          <button data-action="delete" data-file="${loc.file}">Delete this one</button>
          <button data-action="consolidate" data-file="${loc.file}">Consolidate to file...</button>
        </div>
      </div>`;
  }

  container.innerHTML = html;

  // Attach event handlers
  container.querySelectorAll('button[data-action]').forEach(btn => {
    btn.onclick = () => {
      const action = btn.dataset.action;
      const file = btn.dataset.file;
      if (action === 'keep') onKeepOne(file, locations);
      else if (action === 'delete') onDelete(file);
      else if (action === 'consolidate') onConsolidate(file, locations);
    };
  });
}

export function showDiffModal(preview, { onConfirm, onCancel }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  let diffHtml = '';
  for (const [file, changes] of Object.entries(preview)) {
    diffHtml += `<h4>${file}${changes.isNew ? ' (new)' : ''}</h4>`;
    diffHtml += renderDiff(changes.before || '', changes.after);
  }

  overlay.innerHTML = `
    <div class="modal">
      <h3>Preview Changes</h3>
      <div class="diff-preview">${diffHtml}</div>
      <div class="modal-actions">
        <button class="btn-cancel">Cancel</button>
        <button class="btn-confirm">Apply</button>
      </div>
    </div>`;

  overlay.querySelector('.btn-cancel').onclick = () => {
    overlay.remove();
    if (onCancel) onCancel();
  };

  overlay.querySelector('.btn-confirm').onclick = () => {
    overlay.remove();
    if (onConfirm) onConfirm();
  };

  document.body.appendChild(overlay);
}

function renderDiff(before, after) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let html = '';

  // Simple line-by-line diff
  const maxLen = Math.max(beforeLines.length, afterLines.length);
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);

  for (const line of beforeLines) {
    if (!afterSet.has(line)) {
      html += `<span class="diff-removed">- ${escapeHtml(line)}</span>\n`;
    }
  }
  for (const line of afterLines) {
    if (!beforeSet.has(line)) {
      html += `<span class="diff-added">+ ${escapeHtml(line)}</span>\n`;
    }
  }

  return html || '<span style="color:#666">(no changes)</span>\n';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

- [ ] **Step 3: Create main app module**

Create `public/app.js`:

```js
import { initEditor, setContent, getContent, applyHighlights } from './editor.js';
import { renderFileList, renderRedundancyOverview, renderNgramOccurrences, showDiffModal } from './panels.js';

let state = {
  files: [],
  activeFile: null,
  fileFilter: '',
  tagFilter: 'both',
  minOccurrences: 2,
  ngrams: [],
  spans: [],
  dirty: false,
};

const editor = initEditor(document.getElementById('editor'), {
  onContentChange: () => {
    state.dirty = true;
    document.getElementById('save-btn').disabled = false;
  },
  onNgramClicked: (stemmedNgram) => {
    loadNgramOccurrences(stemmedNgram);
  },
});

// --- API helpers ---

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

// --- Load data ---

async function loadFiles() {
  state.files = await api('/files');
  document.getElementById('dir-info').textContent =
    `${state.files.length} file(s)`;
  renderFileList(state.files, {
    onSelect: selectFile,
    activeFile: state.activeFile,
    filter: state.fileFilter,
  });
}

async function selectFile(filePath) {
  if (state.dirty && state.activeFile) {
    if (!confirm('You have unsaved changes. Discard?')) return;
  }

  state.activeFile = filePath;
  state.dirty = false;
  document.getElementById('save-btn').disabled = true;
  document.getElementById('current-file').textContent = filePath;

  renderFileList(state.files, {
    onSelect: selectFile,
    activeFile: state.activeFile,
    filter: state.fileFilter,
  });

  const fileData = await api(`/files/${filePath}`);
  setContent(fileData.content);

  await loadNgrams(filePath);
}

async function loadNgrams(filePath) {
  const data = await api(`/ngrams/${filePath}`);
  state.ngrams = data.ngrams;
  state.spans = data.spans;

  const filteredSpans = filterSpans(state.spans);
  const maxCount = Math.max(...filteredSpans.map(s => s.count || 2), 2);
  applyHighlights(filteredSpans, { maxCount });

  renderRedundancyOverview(state.ngrams, filePath);
}

async function loadNgramOccurrences(stemmedNgram) {
  const data = await api(`/ngrams/${state.activeFile}?ngram=${encodeURIComponent(stemmedNgram)}`);
  renderNgramOccurrences(stemmedNgram, data.locations, state.activeFile, {
    onKeepOne: handleKeepOne,
    onDelete: handleDelete,
    onConsolidate: handleConsolidate,
  });
}

// --- Filtering ---

function filterSpans(spans) {
  return spans.filter(span => {
    if (state.tagFilter !== 'both' && span.tag !== state.tagFilter) return false;
    if (span.count && span.count < state.minOccurrences) return false;
    return true;
  });
}

// --- Merge handlers ---

async function handleKeepOne(keepFile, locations) {
  const otherFiles = locations
    .map(l => l.file)
    .filter(f => f !== keepFile);
  const original = locations[0].original;

  const data = await api('/merge/keep-one', {
    method: 'POST',
    body: { content: original, keepFile, removeFiles: otherFiles, apply: false },
  });

  showDiffModal(data.preview, {
    onConfirm: async () => {
      await api('/merge/keep-one', {
        method: 'POST',
        body: { content: original, keepFile, removeFiles: otherFiles, apply: true },
      });
      await refresh();
    },
  });
}

async function handleDelete(file) {
  const ngrams = state.ngrams;
  // Find the original text for the selected n-gram context
  const original = ngrams.length > 0 ? ngrams[0].original : '';

  const data = await api('/merge/delete', {
    method: 'POST',
    body: { content: original, files: [file], apply: false },
  });

  showDiffModal(data.preview, {
    onConfirm: async () => {
      await api('/merge/delete', {
        method: 'POST',
        body: { content: original, files: [file], apply: true },
      });
      await refresh();
    },
  });
}

async function handleConsolidate(file, locations) {
  const targetFile = prompt('Consolidate to which file?', 'shared.md');
  if (!targetFile) return;

  const sectionName = prompt('Section name?', 'Shared');
  if (!sectionName) return;

  const original = locations[0].original;
  const sourceFiles = locations.map(l => l.file);

  const data = await api('/merge/consolidate', {
    method: 'POST',
    body: { content: original, sectionName, sourceFiles, targetFile, apply: false },
  });

  showDiffModal(data.preview, {
    onConfirm: async () => {
      await api('/merge/consolidate', {
        method: 'POST',
        body: { content: original, sectionName, sourceFiles, targetFile, apply: true },
      });
      await refresh();
    },
  });
}

// --- Save ---

async function save() {
  if (!state.activeFile) return;
  await api(`/files/${state.activeFile}`, {
    method: 'PUT',
    body: { content: getContent() },
  });
  state.dirty = false;
  document.getElementById('save-btn').disabled = true;
  await loadFiles();
  await loadNgrams(state.activeFile);
}

// --- Refresh after merge ---

async function refresh() {
  await loadFiles();
  if (state.activeFile) {
    const fileData = await api(`/files/${state.activeFile}`);
    setContent(fileData.content);
    state.dirty = false;
    document.getElementById('save-btn').disabled = true;
    await loadNgrams(state.activeFile);
  }
}

// --- Event listeners ---

document.getElementById('save-btn').onclick = save;

document.getElementById('file-search').oninput = (e) => {
  state.fileFilter = e.target.value;
  renderFileList(state.files, {
    onSelect: selectFile,
    activeFile: state.activeFile,
    filter: state.fileFilter,
  });
};

document.getElementById('tag-filter').onchange = (e) => {
  state.tagFilter = e.target.value;
  if (state.activeFile) {
    const filteredSpans = filterSpans(state.spans);
    const maxCount = Math.max(...filteredSpans.map(s => s.count || 2), 2);
    applyHighlights(filteredSpans, { maxCount });
  }
};

document.getElementById('min-occurrences').oninput = (e) => {
  state.minOccurrences = parseInt(e.target.value, 10);
  document.getElementById('min-occ-value').textContent = state.minOccurrences;
  if (state.activeFile) {
    const filteredSpans = filterSpans(state.spans);
    const maxCount = Math.max(...filteredSpans.map(s => s.count || 2), 2);
    applyHighlights(filteredSpans, { maxCount });
  }
};

// --- Init ---

loadFiles();
```

- [ ] **Step 4: Verify the full app loads**

```bash
node -e "
import('./src/server.js').then(async m => {
  const app = await m.createApp({ dir: 'test/fixtures/simple', glob: '**/*.md', port: 0, ngramMin: 3, ngramMax: 8 });
  const server = app.listen(3099, async () => {
    const r = await fetch('http://localhost:3099/');
    const html = await r.text();
    console.log('Has editor div:', html.includes('id=\"editor\"'));
    console.log('Has app.js:', html.includes('app.js'));
    server.close();
  });
});
"
```

Expected: both `true`.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/editor.js public/panels.js
git commit -m "feat: frontend app logic with editor, panels, and merge workflows"
```

---

### Task 9: Integration Test + End-to-End Verification

**Files:**
- Modify: `test/api.test.js` (add integration scenarios)

- [ ] **Step 1: Add integration test for full merge workflow**

Add to `test/api.test.js`:

```js
describe('Merge workflow integration', () => {
  it('preview then apply delete removes content', async () => {
    // Use a fresh app with writable fixtures
    const { mkdirSync, writeFileSync, rmSync } = await import('fs');
    const tmpDir = join(import.meta.dirname, 'fixtures', 'tmp-merge');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'a.md'), '# A\n\nShared phrase one two three.\n\nOnly in A.');
    writeFileSync(join(tmpDir, 'b.md'), '# B\n\nShared phrase one two three.\n\nOnly in B.');

    try {
      const tmpApp = await createApp({
        dir: tmpDir, glob: '**/*.md', port: 0, ngramMin: 3, ngramMax: 8,
      });

      // Preview
      const previewRes = await request(tmpApp)
        .post('/api/merge/delete')
        .send({ content: 'Shared phrase one two three.', files: ['a.md'], apply: false });
      assert.equal(previewRes.status, 200);
      assert.ok(previewRes.body.preview['a.md'].before.includes('Shared phrase'));
      assert.ok(!previewRes.body.preview['a.md'].after.includes('Shared phrase'));

      // Apply
      const applyRes = await request(tmpApp)
        .post('/api/merge/delete')
        .send({ content: 'Shared phrase one two three.', files: ['a.md'], apply: true });
      assert.equal(applyRes.status, 200);

      // Verify file was updated
      const fileRes = await request(tmpApp).get('/api/files/a.md');
      assert.ok(!fileRes.body.content.includes('Shared phrase'));
      assert.ok(fileRes.body.content.includes('Only in A'));
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Manual end-to-end smoke test**

```bash
node bin/cli.js test/fixtures/simple --port 3099
```

Expected: browser opens, shows 3 files in left panel sorted by redundancy. Click `intro.md` or `guide.md` — should see highlighted shared phrases. Click a highlight — right panel shows occurrences with action buttons. Kill with Ctrl+C.

- [ ] **Step 4: Commit**

```bash
git add test/api.test.js
git commit -m "feat: integration test for merge workflow"
```

---

### Task 10: CLAUDE.md + Package Finalization

**Files:**
- Create: `CLAUDE.md`
- Modify: `package.json` (add keywords, repository fields)

- [ ] **Step 1: Create CLAUDE.md**

Create `CLAUDE.md`:

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm install                          # install dependencies
node bin/cli.js <dir> [--port N]     # launch against a directory
npm test                             # run all tests (node:test)
npm test -- --test-name-pattern X    # run specific test suite
```

## Architecture

Single-process Express server with three backend modules and a vanilla JS frontend:

- **scanner.js** — discovers files via glob, reads into memory, watches for changes via chokidar
- **extractor.js** — parses markdown with markdown-it, walks AST to produce tagged text segments (prose/code), strips markdown syntax
- **indexer.js** — builds inverted n-gram index from extracted segments using natural (Porter stemming). Computes redundancy scores and merges overlapping n-gram spans
- **merger.js** — implements keep-one, consolidate, delete operations. Returns before/after previews; applies on confirmation
- **server.js** — Express app wiring scanner + indexer + merger into REST API routes. Also serves static frontend from public/

Frontend (public/): vanilla JS modules loaded via ES imports. CodeMirror 5 for editing. Three-panel layout: file list, editor with n-gram highlights, context panel.

## Key Design Decisions

- N-grams are built from AST leaf text nodes (not raw markdown) to avoid syntax pollution
- Stemmed forms used for matching; original text preserved for display
- N-grams never cross structural boundaries (sections, paragraphs, code/prose)
- Merge operations are two-phase: preview diff, then apply on confirmation
- All state in-memory; designed for <50 files
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md with build commands and architecture overview"
```

---

## Self-Review

**Spec coverage check:**
- File scanner: Task 2
- NLP indexer (markdown-it + natural, stemming, n-grams): Tasks 3 + 4
- REST API (all endpoints): Task 6
- Three-panel UI with CodeMirror: Tasks 7 + 8
- Merge operations (keep-one, consolidate, delete, preview/confirm): Task 5
- CLI with args: Task 1
- Redundancy scoring and overlap dedup: Task 4
- Markdown-aware extraction (strip syntax, tag prose/code): Task 3
- fs.watch for external changes: Task 2
- Incremental re-indexing: Task 4 (reindexFile method)

All spec sections covered.

**Placeholder scan:** No TBDs, TODOs, or "fill in later" found.

**Type consistency check:**
- `Scanner` class: constructor(dir, pattern), scan(), getFiles(), getFile(), writeFile(), startWatching() — consistent across Tasks 2, 6
- `extractSegments(markdown)` returns `{text, tag, line}[]` — consistent between Tasks 3, 4
- `Indexer` class: constructor(opts), buildIndex(files), getSharedNgrams(), getMergedSpans(), getNgramLocations(), reindexFile(), getRedundancyReport() — consistent across Tasks 4, 6
- `Merger` class: constructor(files), keepOne(), consolidate(), deleteContent() — consistent across Tasks 5, 6
- API response shapes match what frontend expects in Task 8
