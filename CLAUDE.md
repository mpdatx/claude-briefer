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

Frontend (public/): vanilla JS modules loaded via ES imports. CodeMirror 5 for editing (loaded via CDN as a global, not an ES module). Three-panel layout: file list, editor with n-gram highlights, context panel.

## Key Design Decisions

- N-grams are built from AST leaf text nodes (not raw markdown) to avoid syntax pollution
- Stemmed forms used for matching; original text preserved for display
- N-grams never cross structural boundaries (sections, paragraphs, code/prose)
- Merge operations are two-phase: preview diff, then apply on confirmation
- All state in-memory; designed for <50 files
- ESM throughout ("type": "module" in package.json)
- Tests use node:test built-in runner, supertest for API tests
