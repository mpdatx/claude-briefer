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

  const include = opts.glob ? [opts.glob] : ['**/*.md'];
  const exclude = opts.exclude || [];
  const scanner = new Scanner(opts.dir, { include, exclude });
  await scanner.scan();

  const indexer = new Indexer({
    ngramMin: opts.ngramMin,
    ngramMax: opts.ngramMax,
  });
  indexer.buildIndex(scanner.getFiles());

  scanner.startWatching((relPath, event) => {
    if (event === 'unlink') {
      indexer.buildIndex(scanner.getFiles());
    } else {
      const file = scanner.getFile(relPath);
      if (file) indexer.reindexFile(relPath, file.content);
    }
  });

  // --- Config routes ---

  app.get('/api/config', (req, res) => {
    res.json(scanner.getConfig());
  });

  app.post('/api/config', async (req, res) => {
    const { include, exclude } = req.body;
    await scanner.updateConfig({ include, exclude });
    indexer.buildIndex(scanner.getFiles());
    res.json({ ok: true, fileCount: scanner.getFiles().length });
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

  app.get('/api/files/*path', (req, res) => {
    const filePath = [].concat(req.params.path).join('/');
    const file = scanner.getFile(filePath);
    if (!file) return res.status(404).json({ error: 'File not found' });
    res.json({ path: file.relativePath, content: file.content, size: file.size });
  });

  app.put('/api/files/*path', (req, res) => {
    const filePath = [].concat(req.params.path).join('/');
    const { content } = req.body;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content required' });
    }
    const file = scanner.getFile(filePath);
    if (!file) return res.status(404).json({ error: 'File not found' });
    scanner.writeFile(filePath, content);
    indexer.reindexFile(filePath, content);
    res.json({ ok: true });
  });

  // --- N-gram routes ---

  app.get('/api/ngrams', (req, res) => {
    res.json(indexer.getAllSharedNgrams());
  });

  app.get('/api/ngrams/*path', (req, res) => {
    const filePath = [].concat(req.params.path).join('/');
    if (!filePath) return res.json(indexer.getAllSharedNgrams());

    const file = scanner.getFile(filePath);
    if (!file) return res.status(404).json({ error: 'File not found' });

    if (req.query.ngram) {
      const locations = indexer.getNgramLocations(req.query.ngram);
      return res.json({ ngram: req.query.ngram, locations });
    }

    const ngrams = indexer.getSharedNgrams(filePath);
    const spans = indexer.getMergedSpans(filePath);
    res.json({ ngrams, spans });
  });

  app.get('/api/redundancy', (req, res) => {
    if (req.query.file) {
      return res.json(indexer.getPairwiseScores(req.query.file));
    }
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
