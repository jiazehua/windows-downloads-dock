// ============================================================
//  DownloadsDock — preload（安全桥接）
// ============================================================
const { contextBridge, ipcRenderer } = require('electron')

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
  pasteFiles: () => ipcRenderer.send('paste-files'),
  beginResize: () => ipcRenderer.send('begin-resize'),
  endResize: () => ipcRenderer.send('end-resize'),
  hideDone: () => ipcRenderer.send('hide-done'),

  onShow: (cb) => ipcRenderer.on('popup-show', (_e, d) => cb(d)),
  onHide: (cb) => ipcRenderer.on('popup-hide', () => cb()),
  onDirChanged: (cb) => ipcRenderer.on('dir-changed', () => cb()),
  onDoRename: (cb) => ipcRenderer.on('do-rename', (_e, p) => cb(p))
})
