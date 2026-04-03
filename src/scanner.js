import { glob } from 'glob';
import { readFileSync, writeFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { watch } from 'chokidar';

export class Scanner {
  constructor(dir, opts = {}) {
    if (typeof opts === 'string') {
      // Legacy: new Scanner(dir, pattern)
      opts = { include: [opts] };
    }
    this.dir = dir;
    this.include = opts.include || ['**/*.md'];
    this.exclude = opts.exclude || [];
    this.files = new Map();
    this.watcher = null;
    this.onChange = null;
  }

  async scan() {
    this.files.clear();
    const matches = await glob(this.include, {
      cwd: this.dir,
      nodir: true,
      ignore: this.exclude,
    });
    for (const relPath of matches) {
      this._loadFile(relPath);
    }
  }

  _loadFile(relPath) {
    const absPath = join(this.dir, relPath);
    if (!existsSync(absPath)) return;
    const content = readFileSync(absPath, 'utf-8');
    const stat = statSync(absPath);
    this.files.set(relPath, {
      relativePath: relPath,
      absolutePath: absPath,
      content,
      size: stat.size,
    });
  }

  getConfig() {
    return {
      dir: this.dir,
      include: this.include,
      exclude: this.exclude,
    };
  }

  async updateConfig({ include, exclude }) {
    this.stopWatching();
    if (include) this.include = include;
    if (exclude) this.exclude = exclude;
    await this.scan();
    if (this.onChange) this.startWatching(this.onChange);
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
    this.files.set(relPath, { ...entry, content, size: stat.size });
  }

  startWatching(onChange) {
    this.onChange = onChange;
    this.watcher = watch(this.include, {
      cwd: this.dir,
      ignored: this.exclude,
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
