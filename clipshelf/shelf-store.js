'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

const IMPORT_PREFIX = '.clipshelf-import-';
const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
};
const aborted = signal => { if (signal?.aborted) throw new Error('复制已取消'); };

class ShelfStore {
  constructor(root) {
    fs.mkdirSync(root, { recursive: true });
    this.root = fs.realpathSync.native(root);
  }

  async directory(relative = '') {
    if (typeof relative !== 'string') throw new Error('文件夹路径无效');
    const candidate = path.resolve(this.root, relative);
    if (!within(this.root, candidate)) throw new Error('文件夹不在暂存架中');
    const actual = await fsp.realpath(candidate);
    if (!within(this.root, actual) || !(await fsp.stat(actual)).isDirectory()) throw new Error('文件夹不在暂存架中');
    return actual;
  }

  async entry(file) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('文件路径无效');
    const candidate = path.resolve(file);
    if (candidate === this.root || !within(this.root, candidate) || path.basename(candidate).startsWith(IMPORT_PREFIX)) throw new Error('请选择暂存架中的文件');
    const actual = await fsp.realpath(candidate);
    if (!within(this.root, actual)) throw new Error('该文件指向暂存架之外的位置');
    return candidate;
  }

  async entries(files) {
    if (!Array.isArray(files) || files.length > 10000) throw new Error('文件列表无效');
    const unique = [...new Set(await Promise.all(files.map(file => this.entry(file))))];
    return unique.filter(file => !unique.some(parent => parent !== file && within(parent, file)));
  }

  async list(relative = '') {
    const directory = await this.directory(relative);
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.filter(entry => !entry.name.startsWith(IMPORT_PREFIX)).map(async entry => {
      const file = path.join(directory, entry.name);
      try {
        const stats = await fsp.stat(file);
        return { file, name: entry.name, directory: stats.isDirectory(), size: stats.size, modified: stats.mtimeMs, created: stats.birthtimeMs };
      } catch { return null; }
    }));
    return files.filter(Boolean).sort((a, b) => b.created - a.created || a.name.localeCompare(b.name));
  }

  validName(name) {
    if (typeof name !== 'string' || !name.trim() || name === '.' || name === '..' || /[\x00-\x1f/\\]/.test(name) || name.startsWith(IMPORT_PREFIX)) throw new Error('请输入有效的文件名');
    return name.trim();
  }

  async uniquePath(directory, name) {
    const parsed = path.parse(name);
    for (let number = 1; number < 100000; number++) {
      const file = path.join(directory, number === 1 ? name : `${parsed.name} (${number})${parsed.ext}`);
      try { await fsp.lstat(file); } catch (error) { if (error.code === 'ENOENT') return file; throw error; }
    }
    throw new Error('同名文件过多，请重命名后再试');
  }

  async rename(file, name) {
    const source = await this.entry(file);
    const target = path.join(path.dirname(source), this.validName(name));
    if (target === source) return source;
    try { await fsp.lstat(target); throw new Error('已经存在同名项目'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fsp.rename(source, target);
    return target;
  }

  async newFolder(relative, name) {
    const directory = await this.directory(relative);
    const target = await this.uniquePath(directory, this.validName(name));
    await fsp.mkdir(target);
    return target;
  }

  async import(paths, relative = '', { signal, progress = () => {} } = {}) {
    if (!Array.isArray(paths) || paths.length > 10000 || paths.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw new Error('请选择本地文件或文件夹');
    const directory = await this.directory(relative);
    const sources = [...new Set(paths.map(file => path.resolve(file)))];
    const result = [];
    let bytes = 0;
    let lastUpdate = 0;
    const update = name => {
      if (Date.now() - lastUpdate > 120) { progress({ name, bytes, done: result.length, total: sources.length }); lastUpdate = Date.now(); }
    };
    const copy = async (source, target, ancestors, displayName) => {
      aborted(signal);
      const actual = await fsp.realpath(source);
      const stats = await fsp.stat(actual);
      if (stats.isDirectory()) {
        if (ancestors.has(actual)) throw new Error('文件夹包含循环链接，无法复制');
        const next = new Set(ancestors).add(actual);
        await fsp.mkdir(target);
        for (const name of await fsp.readdir(actual)) await copy(path.join(actual, name), path.join(target, name), next, displayName);
      } else if (stats.isFile()) {
        const monitor = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; update(displayName); callback(null, chunk); } });
        await pipeline(fs.createReadStream(actual), monitor, fs.createWriteStream(target, { flags: 'wx', mode: stats.mode }), { signal });
        await fsp.utimes(target, stats.atime, stats.mtime);
      } else throw new Error('不支持复制设备文件');
    };
    for (const source of sources) {
      aborted(signal);
      const actual = await fsp.realpath(source);
      if (path.dirname(actual) === directory) continue;
      if (within(actual, directory) || within(actual, this.root)) throw new Error('无法把文件夹复制到它自己的内部');
      const temporary = path.join(directory, IMPORT_PREFIX + crypto.randomUUID());
      progress({ name: path.basename(source), bytes, done: result.length, total: sources.length });
      try {
        await copy(actual, temporary, new Set(), path.basename(source));
        aborted(signal);
        const destination = await this.uniquePath(directory, path.basename(source));
        await fsp.rename(temporary, destination);
        result.push(destination);
      } catch (error) {
        // Only this operation's private temporary copy is removed on failure.
        if (within(directory, temporary) && path.basename(temporary).startsWith(IMPORT_PREFIX)) await fsp.rm(temporary, { recursive: true, force: true });
        throw error;
      }
    }
    progress({ bytes, done: result.length, total: sources.length });
    return result;
  }

  async move(files, relative) {
    const sources = await this.entries(files);
    const directory = await this.directory(relative);
    const result = [];
    for (const source of sources) {
      if (path.dirname(source) === directory) continue;
      if (within(source, directory)) throw new Error('无法把文件夹移动到它自己的内部');
      const destination = await this.uniquePath(directory, path.basename(source));
      await fsp.rename(source, destination);
      result.push(destination);
    }
    return result;
  }
}

module.exports = { ShelfStore, within };
