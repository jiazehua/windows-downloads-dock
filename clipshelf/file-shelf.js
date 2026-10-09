'use strict';

// ============================================================
//  暂存架 FileShelf（Windows 版）
//  移植自 ClipShelfMac/file-shelf.js，把 macOS 专属的剪贴板原始格式
//  （public.file-url / NSFilenamesPboardType / osclipboard 自定义格式）
//  换成 DownloadsDock 已有的 CF_HDROP 通道（copy-helper.ps1 / paste-helper.ps1）。
//  「剪切」因为 Windows 剪贴板无法携带自定义 cut 标记，改为进程内状态：
//  在暂存架内部剪切/粘贴能正确移动；把内容粘贴到资源管理器则退化为复制。
// ============================================================

const { app, ipcMain, Menu, nativeImage, shell, dialog } = require('electron');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ShelfStore, within } = require('./shelf-store');

const IMPORT_PREFIX = '.clipshelf-import-';
// 渲染层资源（含备用图标）统一放在 renderer/ 下，与窗口页面同目录
const FALLBACK_ICON = path.join(__dirname, '..', 'renderer', 'assets', 'app.png');

class FileShelf {
  constructor({ root, getWindow, isActive, modal, scriptPath, logError = () => {} }) {
    this.store = new ShelfStore(root);
    this.getWindow = getWindow;
    this.isActive = isActive;
    this.modal = modal;
    this.scriptPath = scriptPath;
    this.logError = logError;
    this.relative = '';
    this.cache = new Map();
    this.jobs = new Map();
    this.operation = null;
    this.progress = null;
    this.sort = 'recent';
    this.cutFiles = [];
    this.watchTimer = null;
    this.watchDirectory();
    this.registerHandlers();
  }

  send(channel, value) {
    const window = this.getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isLoading()) window.webContents.send(channel, value);
  }

  watchDirectory() {
    try { this.watcher?.close(); } catch (e) {}
    const directory = path.join(this.store.root, this.relative);
    try {
      this.watcher = fs.watch(directory, (_event, name) => {
        if (name?.toString().startsWith(IMPORT_PREFIX)) return;
        clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => { if (this.isActive()) this.refresh(); }, 180);
      });
      this.watcher.on('error', () => {});
    } catch (error) {
      this.logError('shelf watch: ' + error.message);
    }
  }

  async state() {
    let files;
    try { files = await this.store.list(this.relative); }
    catch {
      this.relative = '';
      this.watchDirectory();
      files = await this.store.list();
    }
    if (this.sort === 'name') files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    if (this.sort === 'type') files.sort((a, b) => Number(b.directory) - Number(a.directory) || path.extname(a.name).localeCompare(path.extname(b.name)) || a.name.localeCompare(b.name));
    return {
      root: this.store.root, relative: this.relative, sort: this.sort, progress: this.progress,
      cut: this.cutFiles.slice(),
      files: files.map(file => ({ ...file, image: this.cache.get(this.key(file)) || null }))
    };
  }

  key(file) { return `${file.file}\0${file.modified}\0${file.size}`; }

  async refresh() {
    const state = await this.state();
    this.send('shelf-state', state);
    this.loadImages(state.files);
    return state;
  }

  async image(file) {
    const key = this.key(file);
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.jobs.has(key)) return this.jobs.get(key);
    const promise = (async () => {
      let image;
      if (!file.directory) {
        try { image = await nativeImage.createThumbnailFromPath(file.file, { width: 112, height: 112 }); } catch { }
      }
      if (!image || image.isEmpty()) {
        try { image = await app.getFileIcon(file.file, { size: 'large' }); } catch { }
      }
      if (!image || image.isEmpty()) image = nativeImage.createFromPath(FALLBACK_ICON);
      const result = image && !image.isEmpty() ? image.toDataURL() : '';
      if (this.cache.size > 700) this.cache.clear();
      this.cache.set(key, result);
      return result;
    })();
    this.jobs.set(key, promise);
    try { return await promise; } finally { this.jobs.delete(key); }
  }

  async loadImages(files) {
    const pending = files.filter(file => !file.image);
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (index < pending.length) {
        const file = pending[index++];
        try { this.send('shelf-image', { file: file.file, image: await this.image(file) }); } catch { }
      }
    }));
  }

  handle(channel, action) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (event.sender !== this.getWindow()?.webContents) return { error: '窗口不可用' };
      try { return await action(...args); }
      catch (error) { return { error: error.name === 'AbortError' ? '复制已取消' : error.message }; }
    });
  }

  registerHandlers() {
    this.handle('shelf-get-state', () => this.refresh());
    this.handle('shelf-import', paths => this.import(paths));
    this.handle('shelf-paste', () => this.paste());
    this.handle('shelf-copy', (files, cut) => this.copy(files, cut));
    this.handle('shelf-navigate', async relative => {
      const directory = await this.store.directory(relative);
      this.relative = path.relative(this.store.root, directory);
      this.watchDirectory();
      return this.refresh();
    });
    this.handle('shelf-open', async files => {
      for (const file of await this.store.entries(files)) {
        const error = await shell.openPath(file);
        if (error) throw new Error(error);
      }
      return {};
    });
    this.handle('shelf-reveal', async files => {
      for (const file of await this.store.entries(files)) shell.showItemInFolder(file);
      return {};
    });
    this.handle('shelf-open-folder', async () => {
      const error = await shell.openPath(await this.store.directory(this.relative));
      if (error) throw new Error(error);
      return {};
    });
    this.handle('shelf-rename', async (file, name) => {
      const renamed = await this.store.rename(file, name);
      await this.refresh();
      return { files: [renamed] };
    });
    this.handle('shelf-new-folder', async name => {
      const folder = await this.store.newFolder(this.relative, name);
      await this.refresh();
      return { files: [folder] };
    });
    this.handle('shelf-trash', files => this.trash(files));
    this.handle('shelf-context', files => this.context(files));
    ipcMain.on('shelf-cancel', event => { if (event.sender === this.getWindow()?.webContents) this.operation?.abort(); });
    ipcMain.on('shelf-drag', (event, files) => {
      if (event.sender !== this.getWindow()?.webContents || !Array.isArray(files)) return;
      // 同步校验，保证原生拖拽能在拖拽手势内启动
      const valid = [...new Set(files)].filter(file => {
        try { const actual = fs.realpathSync.native(file); return typeof file === 'string' && actual !== this.store.root && within(this.store.root, actual); } catch { return false; }
      });
      if (!valid.length) return;
      const cached = [...this.cache].find(([key]) => key.startsWith(valid[0] + '\0'));
      let icon = cached ? nativeImage.createFromDataURL(cached[1]) : null;
      if (!icon || icon.isEmpty()) icon = nativeImage.createFromPath(FALLBACK_ICON);
      const allFiles = valid.every(file => { try { return fs.statSync(file).isFile(); } catch { return false; } });
      if (allFiles) {
        try { event.sender.startDrag(valid.length === 1 ? { file: valid[0], icon } : { files: valid, icon }); }
        catch (error) { this.send('shelf-error', error.message); }
      } else {
        // 含文件夹：webContents.startDrag 处理不了，走 WinForms DoDragDrop 通道
        const script = this.scriptPath('drag-helper.ps1');
        if (!fs.existsSync(script)) { this.send('shelf-error', 'drag-helper.ps1 缺失'); return; }
        const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
        child.stdin.write(valid.join('\n'));
        child.stdin.end();
        child.on('error', error => this.send('shelf-error', error.message));
      }
    });
  }

  runHelper(name, input) {
    return new Promise((resolve, reject) => {
      const script = this.scriptPath(name);
      if (!fs.existsSync(script)) return reject(new Error(name + ' 缺失'));
      const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true });
      let out = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => { out += chunk; });
      child.on('error', reject);
      child.on('exit', () => resolve(out));
      if (input) { child.stdin.write(input.join('\n')); }
      child.stdin.end();
    });
  }

  async import(files) {
    if (this.operation) throw new Error('请等待当前复制完成');
    this.operation = new AbortController();
    try {
      const imported = await this.store.import(files, this.relative, {
        signal: this.operation.signal,
        progress: progress => { this.progress = progress; this.send('shelf-progress', progress); }
      });
      return { files: imported };
    } finally {
      this.operation = null;
      this.progress = null;
      this.send('shelf-progress', null);
      await this.refresh();
    }
  }

  async copy(files, cut) {
    const selected = await this.store.entries(files);
    if (!selected.length) return {};
    await this.runHelper('copy-helper.ps1', selected);
    this.cutFiles = cut ? selected : [];
    this.send('shelf-cut', this.cutFiles.slice());
    return { copied: selected, cut: Boolean(cut) };
  }

  async clipboardFiles() {
    const raw = (await this.runHelper('paste-helper.ps1')).trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.filter(item => typeof item === 'string' && path.isAbsolute(item));
    } catch {
      return [];
    }
  }

  async paste() {
    if (this.cutFiles.length) {
      const source = this.cutFiles.slice();
      this.cutFiles = [];
      this.send('shelf-cut', []);
      const moved = await this.store.move(source, this.relative);
      await this.refresh();
      return { files: moved };
    }
    const files = await this.clipboardFiles();
    if (!files.length) throw new Error('剪贴板里没有可粘贴的本地文件，请先在资源管理器中复制文件');
    return this.import(files);
  }

  async trash(files) {
    const selected = await this.store.entries(files);
    if (!selected.length) return {};
    this.modal(true);
    try {
      const answer = await dialog.showMessageBox(this.getWindow(), {
        type: 'question', message: `将 ${selected.length} 个项目移到回收站？`,
        detail: '删除的是暂存架中的副本。', buttons: ['取消', '移到回收站'], defaultId: 0, cancelId: 0
      });
      if (answer.response !== 1) return {};
      for (const file of selected) await shell.trashItem(file);
      await this.refresh();
      return {};
    } finally { this.modal(false); }
  }

  async context(files) {
    const selected = await this.store.entries(files);
    const command = action => this.send('shelf-command', action);
    const cutCount = this.cutFiles.length;
    const menu = Menu.buildFromTemplate([
      { label: '打开', enabled: selected.length > 0, click: () => command('open') },
      { label: '在资源管理器中显示', enabled: selected.length > 0, click: () => command('reveal') },
      { type: 'separator' },
      { label: '剪切', accelerator: 'CommandOrControl+X', enabled: selected.length > 0, click: () => command('cut') },
      { label: '复制', accelerator: 'CommandOrControl+C', enabled: selected.length > 0, click: () => command('copy') },
      { label: cutCount ? `粘贴（移动 ${cutCount} 项）` : '粘贴', accelerator: 'CommandOrControl+V', click: () => command('paste') },
      { label: '重命名…', enabled: selected.length === 1, click: () => command('rename') },
      { label: '移到回收站', enabled: selected.length > 0, click: () => command('trash') },
      { type: 'separator' },
      { label: '新建文件夹…', click: () => command('new-folder') },
      { label: '全选', accelerator: 'CommandOrControl+A', click: () => command('select-all') },
      { label: '排列方式', submenu: [
        { label: '最近加入', type: 'radio', checked: this.sort === 'recent', click: () => { this.sort = 'recent'; this.refresh(); } },
        { label: '名称', type: 'radio', checked: this.sort === 'name', click: () => { this.sort = 'name'; this.refresh(); } },
        { label: '文件类型', type: 'radio', checked: this.sort === 'type', click: () => { this.sort = 'type'; this.refresh(); } }
      ] }
    ]);
    this.modal(true);
    menu.popup({ window: this.getWindow(), callback: () => this.modal(false) });
    return {};
  }

  close() {
    try { this.watcher?.close(); } catch (e) {}
    clearTimeout(this.watchTimer);
    this.operation?.abort();
  }
}

module.exports = { FileShelf };
