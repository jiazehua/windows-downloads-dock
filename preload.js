// ============================================================
//  DownloadsDock + ClipShelf — 合并后的 preload（安全桥接）
//  同一个窗口里同时暴露两套 API：
//    window.dock  → 左侧下载浮层
//    window.shelf → 右侧 ClipShelf（最近图片 + 暂存架）
//  预览小窗（preview.html）也复用本文件，只用到 window.shelf.onPreview。
// ============================================================
const { contextBridge, ipcRenderer, webUtils } = require('electron')

// ------------------------------------------------------------
//  左栏：下载浮层
// ------------------------------------------------------------
contextBridge.exposeInMainWorld('dock', {
  listFiles: () => ipcRenderer.invoke('list-files'),
  getCurrentDir: () => ipcRenderer.invoke('get-current-dir'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getThumbnail: (p, size) => ipcRenderer.invoke('get-thumbnail', p, size),

  openPath: (p) => ipcRenderer.send('open-path', p),
  enterDir: (p) => ipcRenderer.send('enter-dir', p),
  navigateUp: () => ipcRenderer.send('navigate-up'),
  showInFolder: (p) => ipcRenderer.send('show-in-folder', p),
  copyPath: (p) => ipcRenderer.send('copy-path', p),
  trash: (p) => ipcRenderer.send('trash', p),
  rename: (oldP, newName) => ipcRenderer.invoke('rename', oldP, newName),
  startDrag: (paths) => ipcRenderer.send('start-drag', paths),
  showContextMenu: (items) => ipcRenderer.send('show-context-menu', items),
  showSettingsMenu: () => ipcRenderer.send('show-settings-menu'),
  copyFiles: (paths) => ipcRenderer.send('copy-files', paths),
  cutFiles: (paths) => ipcRenderer.send('cut-files', paths),
  pasteFiles: () => ipcRenderer.send('paste-files'),
  extractArchive: (p) => ipcRenderer.invoke('extract-archive', p),
  beginResize: () => ipcRenderer.send('begin-resize'),
  endResize: () => ipcRenderer.send('end-resize'),
  hideDone: () => ipcRenderer.send('hide-done'),

  onShow: (cb) => ipcRenderer.on('popup-show', (_e, d) => cb(d)),
  onHide: (cb) => ipcRenderer.on('popup-hide', () => cb()),
  onDirChanged: (cb) => ipcRenderer.on('dir-changed', () => cb()),
  onDoRename: (cb) => ipcRenderer.on('do-rename', (_e, p) => cb(p)),
  onDoPaste: (cb) => ipcRenderer.on('do-paste', () => cb())
})

// ------------------------------------------------------------
//  右栏：ClipShelf
// ------------------------------------------------------------
contextBridge.exposeInMainWorld('shelf', {
  getState: () => ipcRenderer.invoke('get-state'),
  onState: callback => ipcRenderer.on('state', (_event, data) => callback(data)),
  onOpenSettings: callback => ipcRenderer.on('open-settings', callback),
  onPreview: callback => ipcRenderer.on('preview-data', (_event, data) => callback(data)),
  hide: () => ipcRenderer.send('hide-panel'),
  setPinned: value => ipcRenderer.send('set-pinned', value),
  openFolder: () => ipcRenderer.send('open-folder'),
  revealFile: file => ipcRenderer.send('reveal-file', file),
  previewShow: file => ipcRenderer.send('preview-show', file),
  previewHide: () => ipcRenderer.send('preview-hide'),
  // ⚠️ 通道名必须是 shot-drag：dock 侧已经占用了 start-drag（数组入参），
  //    两者混用会导致拖拽截图时把「一个字符串」当路径数组处理。
  startDrag: file => ipcRenderer.send('shot-drag', file),
  dragEnded: () => ipcRenderer.send('drag-ended'),
  reorder: files => ipcRenderer.invoke('shelf-reorder', files),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  saveRetention: days => ipcRenderer.invoke('save-retention', days),
  setShelfOpen: open => ipcRenderer.invoke('set-shelf-open', open),
  resizeShelf: (width, finished) => ipcRenderer.invoke('resize-shelf', width, finished),
  onShelfWidth: callback => ipcRenderer.on('shelf-width', (_event, width) => callback(width)),
  files: {
    getState: () => ipcRenderer.invoke('shelf-get-state'),
    onState: callback => ipcRenderer.on('shelf-state', (_event, state) => callback(state)),
    onImage: callback => ipcRenderer.on('shelf-image', (_event, image) => callback(image)),
    onProgress: callback => ipcRenderer.on('shelf-progress', (_event, progress) => callback(progress)),
    onCommand: callback => ipcRenderer.on('shelf-command', (_event, command) => callback(command)),
    onError: callback => ipcRenderer.on('shelf-error', (_event, error) => callback(error)),
    importFiles: files => ipcRenderer.invoke('shelf-import', Array.from(files, file => webUtils.getPathForFile(file)).filter(Boolean)),
    copy: (files, cut) => ipcRenderer.invoke('shelf-copy', files, cut),
    paste: () => ipcRenderer.invoke('shelf-paste'),
    navigate: relative => ipcRenderer.invoke('shelf-navigate', relative),
    open: files => ipcRenderer.invoke('shelf-open', files),
    reveal: files => ipcRenderer.invoke('shelf-reveal', files),
    openFolder: () => ipcRenderer.invoke('shelf-open-folder'),
    rename: (file, name) => ipcRenderer.invoke('shelf-rename', file, name),
    newFolder: name => ipcRenderer.invoke('shelf-new-folder', name),
    trash: files => ipcRenderer.invoke('shelf-trash', files),
    context: files => ipcRenderer.invoke('shelf-context', files),
    startDrag: files => ipcRenderer.send('shelf-drag', files),
    cancel: () => ipcRenderer.send('shelf-cancel')
  }
})
