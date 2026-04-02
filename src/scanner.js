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
