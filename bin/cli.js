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
