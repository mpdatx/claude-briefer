# Claude Briefer — Design Spec

A web-based tool for detecting and removing redundant content across markdown documentation files. Launched via `npx claude-briefer ./docs`, it scans a directory, indexes all files for repeated content using n-gram analysis, and provides a browser UI for reviewing and merging duplicates.

Primary use case: cleaning up AI-generated documentation where multiple files repeat the same concepts.

## Architecture

Single-process monolithic Express server with three layers:

### File Scanner

- Recursively scans target directory for files matching a configurable glob (default: `**/*.md`)
- Reads all files into memory on startup
- Watches for external changes via `fs.watch` to keep in-memory state current

### NLP Indexer

- Parses each file with `markdown-it` to produce an AST
- Walks the AST to extract text segments, tagged as `prose` or `code`
- Builds an inverted n-gram index mapping each n-gram to `{file, line, tag}` locations
- Uses `natural` library for tokenization and Porter stemming

### Web Server

- Express serves static frontend assets (vanilla HTML/JS/CSS) and a REST API
- CodeMirror for the raw markdown editor
- All state lives in memory; designed for small corpora (<50 files)

## REST API

### File operations

- `GET /api/files` — list all scanned files with metadata (path, size, redundancy score)
- `GET /api/files/:path` — get file content
- `PUT /api/files/:path` — write file content back to disk

### Analysis

- `GET /api/ngrams/:path` — get n-grams for a file with cross-file occurrence counts
- `GET /api/ngrams/:path?ngram=<stemmed+tokens>` — get all locations where a specific n-gram appears across the corpus
- `GET /api/redundancy` — corpus-wide redundancy report: files ranked by duplicated content percentage, with overlapping files and shared n-grams

### Merge operations

- `POST /api/merge/keep-one` — keep content in one file, remove from others
- `POST /api/merge/consolidate` — move content to a target file, replace with markdown links
- `POST /api/merge/delete` — remove content from specified locations

All merge endpoints return diff previews before applying. A second confirmation call applies the changes.

## Frontend UI

### Layout

Three-panel design:

**Left panel — File list**
- Sorted by redundancy score (most redundant first)
- Each file shows name and a redundancy indicator
- Search/filter box at top
- Click to select a file

**Center panel — Editor**
- CodeMirror showing raw markdown of selected file
- N-grams appearing in other files are highlighted inline with background color
- Highlight intensity scales with occurrence count (more files = stronger)
- Clicking a highlighted n-gram populates the right panel

**Right panel — Context**
Two modes:
- **N-gram view** (when n-gram clicked): shows all other files containing it with surrounding context. Action buttons per occurrence: "Keep here, remove others," "Delete this one," "Consolidate to file..."
- **File redundancy overview** (default): summary of this file's overlap with others — most-overlapping files and specific shared phrases/sections

**Top bar**
- Scanned directory path and file count
- Toggle for n-gram highlight filter: prose only / code only / both
- Minimum n-gram occurrence threshold slider (default: 2+ files)

## N-gram Analysis

### Markdown-aware text extraction

`markdown-it`'s AST separates structure from content. We walk AST leaf nodes and collect text content, which naturally excludes syntax markers:

- Inline formatting (`**bold**`, `*italic*`, etc.) — extract inner text only
- Links (`[text](url)`) — extract link text, discard URL
- Images (`![alt](url)`) — extract alt text only
- Headings (`## Heading`) — extract heading text, discard markers
- HTML tags — strip tags, keep inner text
- List markers (`-`, `*`, `1.`) — discard, keep item text
- Blockquote markers (`>`) — discard, keep quoted text

Code blocks: extract raw code content as-is (code syntax is meaningful content). Inline code backticks are stripped but content preserved.

Text is never concatenated across structural boundaries to avoid false n-gram matches.

### Tagging

Each text segment is tagged:
- `prose` — paragraphs, headings, list items, blockquotes
- `code` — fenced code blocks, inline code
- `frontmatter` — YAML/TOML front matter (skipped from analysis by default)

### Tokenization and stemming

Using `natural` library:
- Tokenize text into words
- Apply Porter stemming ("installing" and "installation" match)
- Store both stemmed form (for matching) and original text (for display)

### N-gram generation

- Generate n-grams of sizes 3 through 8 (configurable)
- N-grams do not cross tag boundaries (prose n-gram won't bleed into code)
- N-grams do not cross paragraph/section boundaries within the same tag type

### Redundancy scoring

A file's redundancy score: percentage of text content appearing in other files.

Formula: `sum of (n-gram_length² * occurrence_count)` for all n-grams in 2+ files, divided by total text length. Longer shared n-grams weighted more heavily (8-gram match is more significant than a coincidental 3-gram match).

### Overlap deduplication

Raw n-gram matches overlap heavily (an 8-gram contains six 3-grams). When displaying, overlapping matches merge into the longest contiguous shared span. A 30-word shared passage shows as one highlight, not dozens of overlapping hits.

## Merge Operations

### Strategies

**Keep one:** User picks which file retains the content. Removed from all other specified files. If removing leaves an empty section (heading with no content), the heading is removed too.

**Consolidate:** User picks or names a target file. Content moves there. Source files get a markdown reference: `> See [Section Name](target-file.md#section)`. Target file created if it doesn't exist.

**Delete:** Removes content from selected locations.

### Preview and confirm

All operations work in two steps:
1. Compute changes, return diffs for each affected file
2. User reviews diffs in UI, confirms or cancels

### Granularity

Merge operations can target:
- A highlighted n-gram span (the merged longest match)
- An entire markdown section (heading to next heading of equal or higher level)
- A manual text selection in the editor

### Post-merge

In-memory index is incrementally updated after changes — no full re-index needed for small edits.

## Tech Stack

- **Runtime:** Node.js
- **Server:** Express
- **Markdown parsing:** markdown-it
- **NLP:** natural (tokenization, stemming)
- **Editor:** CodeMirror
- **Frontend:** Vanilla HTML/JS/CSS
- **Distribution:** npm package, invoked via `npx claude-briefer <path>`

## CLI Interface

```
npx claude-briefer <directory> [options]
  --glob <pattern>     File pattern to scan (default: "**/*.md")
  --port <number>      Server port (default: 3000)
  --ngram-min <n>      Minimum n-gram size (default: 3)
  --ngram-max <n>      Maximum n-gram size (default: 8)
```

Launches the server and opens the browser automatically.
