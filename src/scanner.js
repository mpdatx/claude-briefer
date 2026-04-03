import { glob } from 'glob';
import { readFileSync, writeFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { watch } from 'chokidar';

export class Scanner {
  constructor(sources) {
    // sources: [{ dir, pattern }] or legacy (dir, pattern)
    if (typeof sources === 'string') {
      // Legacy constructor: new Scanner(dir, pattern)
      this.sources = [{ dir: sources, pattern: arguments[1] || '**/*.md' }];
    } else {
      this.sources = sources;
    }
    this.files = new Map();
    this.watchers = [];
    this.onChange = null;
  }

  async scan() {
    this.files.clear();

    for (const { dir, pattern } of this.sources) {
      if (!existsSync(dir)) continue;
      const matches = await glob(pattern, { cwd: dir, nodir: true });
      for (const relPath of matches) {
        // Prefix with source dir name if multiple sources
        const key = this.sources.length > 1
          ? join(relative(this._commonRoot(), dir), relPath)
          : relPath;
        this._loadFile(dir, relPath, key);
      }
    }
  }

  _commonRoot() {
    if (this.sources.length === 1) return this.sources[0].dir;
    // Find common parent of all source dirs
    const parts = this.sources.map(s => s.dir.split('/'));
    const common = [];
    for (let i = 0; i < parts[0].length; i++) {
      if (parts.every(p => p[i] === parts[0][i])) {
        common.push(parts[0][i]);
      } else break;
    }
    return common.join('/') || '/';
  }

  _loadFile(dir, relPath, key) {
    const absPath = join(dir, relPath);
    const content = readFileSync(absPath, 'utf-8');
    const stat = statSync(absPath);
    this.files.set(key || relPath, {
      relativePath: key || relPath,
      absolutePath: absPath,
      content,
      size: stat.size,
    });
  }

  getSources() {
    return this.sources.map(s => ({ dir: s.dir, pattern: s.pattern }));
  }

  async updateSources(sources) {
    this.stopWatching();
    this.sources = sources;
    await this.scan();
    if (this.onChange) {
      this.startWatching(this.onChange);
    }
  }

  getFiles() {
    return Array.from(this.files.values());
  }

  getFile(relPath) {
    return this.files.get(relPath) || null;
  }

  writeFile(relPath, content) {
    const entry = this.files.get(relPath);
    if (!entry) return;
    writeFileSync(entry.absolutePath, content, 'utf-8');
    const stat = statSync(entry.absolutePath);
    this.files.set(relPath, {
      ...entry,
      content,
      size: stat.size,
    });
  }

  startWatching(onChange) {
    this.onChange = onChange;
    for (const { dir, pattern } of this.sources) {
      const watcher = watch(pattern, {
        cwd: dir,
        ignoreInitial: true,
      });

      watcher.on('change', (relPath) => {
        const key = this.sources.length > 1
          ? join(relative(this._commonRoot(), dir), relPath)
          : relPath;
        this._loadFile(dir, relPath, key);
        if (this.onChange) this.onChange(key, 'change');
      });

      watcher.on('add', (relPath) => {
        const key = this.sources.length > 1
          ? join(relative(this._commonRoot(), dir), relPath)
          : relPath;
        this._loadFile(dir, relPath, key);
        if (this.onChange) this.onChange(key, 'add');
      });

      watcher.on('unlink', (relPath) => {
        const key = this.sources.length > 1
          ? join(relative(this._commonRoot(), dir), relPath)
          : relPath;
        this.files.delete(key);
        if (this.onChange) this.onChange(key, 'unlink');
      });

      this.watchers.push(watcher);
    }
  }

  stopWatching() {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
  }
}
