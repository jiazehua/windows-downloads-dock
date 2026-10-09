// ============================================================
//  DownloadsDock — 主进程
//  任务栏锚点窗口 + 优雅浮层窗口 + 拖拽/图标/文件操作 + 键盘钩子
// ============================================================
const { app, BrowserWindow, ipcMain, shell, clipboard, screen, dialog, Menu, nativeImage, Tray } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

const APP_ID = 'com.chuanshanjia.downloadsdock'
app.setAppUserModelId(APP_ID)

const POP_W = 484
const POP_H = 628
const MIN_W = 320
const MAX_W = 900

// ---------- 错误日志（打包后排错用，写入 userData/error.log） ----------
let logFile = ''
try { logFile = path.join(app.getPath('userData'), 'error.log') } catch (e) {}
function logError(msg) {
  if (!logFile) return
  try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`) } catch (e) {}
}
process.on('uncaughtException', (err) => { logError('uncaughtException: ' + ((err && err.stack) || String(err))) })
process.on('unhandledRejection', (reason) => { logError('unhandledRejection: ' + String(reason)) })

// 打包后 .ps1 会被压进 app.asar（虚拟文件系统），外部进程（powershell.exe）无法访问。
// 必须用 asarUnpack（真实文件在 app.asar.unpacked/）并在这里指向真实路径。
function scriptPath(name) {
  return path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), name)
}

let anchorWin = null
let popupWin = null
let tray = null
let hookProc = null
let dragging = false
let appReady = false
let currentPath = ''
let iconCache = {}
let watcher = null
let watchTimer = null
let anchorReady = false
let anchorHandling = false
const thumbnailCache = new Map()
const PREVIEW_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.heic', '.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.pdf'])
let focusPollTimer = null
let unfocusedSamples = 0
let popupState = 'hidden'
let hideFallbackTimer = null
let blurTimer = null
let isEnabled = true

// ---------- 配置 ----------
const cfgPath = path.join(app.getPath('userData'), 'config.json')
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) } catch (e) { return {} }
}
function saveConfig(cfg) {
  try { fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)) } catch (e) {}
}
let config = loadConfig()
isEnabled = config.enabled !== false
let popupWidth = Math.max(MIN_W, Math.min(MAX_W, Number(config.popupWidth) || POP_W))

function defaultDownload() {
  const h = app.getPath('downloads')
  try { return fs.existsSync(h) ? h : app.getPath('documents') } catch (e) { return app.getPath('home') }
}
currentPath = (config.downloadPath && fs.existsSync(config.downloadPath)) ? config.downloadPath : defaultDownload()

// ---------- 图标缓存 ----------
async function getIcon(fullPath, ext) {
  const key = ext ? ('ext:' + ext) : 'dir'
  if (iconCache[key]) return iconCache[key]
  try {
    const img = await app.getFileIcon(fullPath, { size: 'large' })
    const data = img.toDataURL()
    iconCache[key] = data
    return data
  } catch (e) { return '' }
}

// ---------- 列出目录 ----------
async function listDir(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    const items = entries.map(de => {
      const full = path.join(dir, de.name)
      const isDir = de.isDirectory()
      let size = 0, mtime = ''
      if (!isDir) {
        try { const st = fs.statSync(full); size = st.size; mtime = st.mtimeMs } catch (e) {}
      } else {
        try { mtime = fs.statSync(full).mtimeMs } catch (e) {}
      }
      return { name: de.name, isDir, size, mtime, ext: isDir ? '' : path.extname(de.name).toLowerCase() }
    })
    // Newest downloads first, regardless of whether the entry is a folder.
    items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || a.name.localeCompare(b.name, 'zh-Hans-CN'))
    // Return directory contents immediately.  Calling getFileIcon for every
    // entry can block for a long time on large Downloads folders, archives,
    // network shortcuts and unavailable drives, leaving the popup blank.
    const out = items.map(it => ({ ...it, icon: '' }))
    return { dir, items: out, currentPath }
  } catch (err) {
    return { dir, items: [], error: String(err) }
  }
}

// ---------- 浮层窗口 ----------
function createPopup() {
  popupState = 'hidden'
  popupWin = new BrowserWindow({
    title: '\u200B',
    width: popupWidth, height: POP_H,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  popupWin.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  popupWin.setTitle('\u200B')
  popupWin.on('page-title-updated', (event) => {
    event.preventDefault()
    popupWin.setTitle('\u200B')
  })
  popupWin.webContents.on('did-fail-load', (_event, code, description) => {
    logError(`popup did-fail-load: ${code} ${description}`)
  })
  popupWin.webContents.on('console-message', (_event, levelOrDetails, message, line, sourceId) => {
    if (levelOrDetails && typeof levelOrDetails === 'object') {
      logError(`renderer console: ${levelOrDetails.message || JSON.stringify(levelOrDetails)}`)
    } else {
      logError(`renderer console: ${message} (${sourceId || ''}:${line || 0})`)
    }
  })
  popupWin.webContents.on('render-process-gone', (_event, details) => {
    logError('renderer gone: ' + JSON.stringify(details))
  })
  popupWin.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      event.preventDefault()
      dismissPopup('escape')
    }
  })
  // 注意：level 参数仅 macOS 支持，Windows 上传入会抛异常导致后续初始化中断
  try { popupWin.setAlwaysOnTop(true) } catch (e) { logError('setAlwaysOnTop: ' + e.message) }
  popupWin.on('blur', () => {
    if (dragging || popupState !== 'visible' || Date.now() - showTime < 250) return
    hidePopup('blur')
  })
  popupWin.on('minimize', () => {
    if (popupState !== 'hidden') hidePopup('taskbar-minimize')
  })
  popupWin.on('restore', () => {
    if (isEnabled && popupState === 'hidden') showPopup()
  })
  // Windows taskbar "Close window" must only dismiss the stack.  The tray's
  // explicit Exit command is the sole action that destroys the app window.
  popupWin.on('close', (event) => {
    if (app.isQuitting) return
    event.preventDefault()
    dismissPopup('window-close')
  })
  popupWin.on('closed', () => {
    popupWin = null
    popupState = 'hidden'
  })
}

// ---------- 锚点窗口（任务栏按钮） ----------
function createAnchor() {
  anchorWin = new BrowserWindow({
    width: 1, height: 1,
    x: 0, y: 0,
    frame: false,
    transparent: true,
    skipTaskbar: false,
    resizable: false,
    show: false,
    focusable: true,
    hasShadow: false
  })
  try { anchorWin.setOpacity(0) } catch (e) { logError('anchor setOpacity: ' + e.message) }
  // The anchor only exists so Windows exposes a taskbar button.  Its transparent
  // 1x1 client area must never consume a click intended for another application.
  try { anchorWin.setIgnoreMouseEvents(true, { forward: false }) } catch (e) { logError('anchor mouse passthrough: ' + e.message) }
  const activateFromTaskbar = () => {
    if (!appReady || !anchorReady || anchorHandling || !isEnabled) return
    anchorHandling = true
    // Keep the taskbar proxy minimized.  A taskbar click then reliably emits
    // "restore" on Windows, even when the transparent proxy was focused before.
    try { if (!anchorWin.isMinimized()) anchorWin.minimize() } catch (e) {}
    setTimeout(() => togglePopup('taskbar'), 0)
    setTimeout(() => { anchorHandling = false }, 500)
  }
  anchorWin.on('restore', activateFromTaskbar)
  anchorWin.on('focus', activateFromTaskbar)
  anchorWin.loadURL('about:blank').then(() => {
    // showInactive avoids stealing focus from the popup during startup.
    anchorWin.showInactive()
    anchorWin.minimize()
    anchorReady = true
  }).catch(e => logError('anchor load: ' + e.message))
}

// ---------- 显示 / 隐藏 ----------
let showTime = 0

function positionPopup() {
  // 多屏：浮层要出现在鼠标当前所在的那块屏上（托盘 / 任务栏 / 快捷键都可能在任何一块屏触发）。
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const wa = display.workArea
  const x = wa.x + Math.round((wa.width - popupWidth) / 2)
  const y = wa.y + wa.height - POP_H - 6
  // ⚠️ 关键顺序：Windows 会直接忽略对「已最小化」窗口的 SetWindowPos。
  // 浮层的隐藏走的是 minimize()，所以定位前必须先 restore()，否则 setPosition 完全无效，
  // 窗口会一直停在上一次最小化之前的位置 —— 表现就是不管鼠标在哪块屏，浮层都固定出现在同一块屏。
  // restore 之后立刻 hide()，是为了避免在旧位置闪一帧；对已隐藏的窗口 setPosition 依然有效。
  // 顺序不可改成 setPosition → restore（那样 restore 会把窗口又拉回原位，等于没修）。
  if (popupWin.isMinimized()) {
    try {
      popupWin.restore()
      popupWin.hide()
    } catch (e) { logError('positionPopup un-minimize: ' + e.message) }
  }
  popupWin.setPosition(x, y, false)
  let actual = [x, y]
  try { actual = popupWin.getPosition() } catch (e) {}
  logError(`popup position: want=${x},${y} actual=${actual[0]},${actual[1]} display=${display.id} cursor=${cursor.x},${cursor.y} scale=${display.scaleFactor}`)
}

function doShow() {
  if (!isEnabled || !popupWin || popupWin.isDestroyed() || popupState === 'visible') return
  clearTimeout(blurTimer)
  popupState = 'showing'
  showTime = Date.now()
  try { if (popupWin.isMinimized()) popupWin.restore() } catch (e) {}
  popupWin.show()
  popupWin.focus()
  popupState = 'visible'
  startFocusPolling()
  popupWin.webContents.send('popup-show', { dir: currentPath })
  // Make visibility deterministic even if the initial IPC message arrives
  // before renderer listeners are attached.
  popupWin.webContents.executeJavaScript(`(() => {
    const el = document.getElementById('popup')
    if (!el) return 'popup element missing'
    el.classList.add('visible')
    return 'popup visible; dock=' + typeof window.dock
  })()`).then(result => logError('renderer state: ' + result))
    .catch(err => logError('renderer show failed: ' + err.message))
  logError('popup shown')
}

function startFocusPolling() {
  if (focusPollTimer) clearInterval(focusPollTimer)
  unfocusedSamples = 0
  focusPollTimer = setInterval(() => {
    if (!popupWin || popupState === 'hidden' || !popupWin.isVisible()) {
      clearInterval(focusPollTimer)
      focusPollTimer = null
      return
    }
    if (dragging || popupState !== 'visible' || Date.now() - showTime < 300) return
    if (popupWin.isFocused()) {
      unfocusedSamples = 0
      return
    }
    if (++unfocusedSamples >= 2) hidePopup('focus-poll')
  }, 60)
}

function showPopup() {
  if (!isEnabled || popupState === 'visible' || popupState === 'showing') return
  if (!popupWin || popupWin.isDestroyed()) createPopup()
  // 先上锁再定位：positionPopup() 内部会调用 restore()，而 restore 会触发窗口的
  // 'restore' 事件回调（见 createPopup 里的 popupWin.on('restore') → showPopup()），
  // 此处若还是 'hidden' 就会重入 showPopup，随后 positionPopup 里的 hide() 会把刚弹出的
  // 浮层又藏起来，表现为「按了快捷键没反应」。
  popupState = 'showing'
  try {
    positionPopup()
    if (popupWin.webContents.isLoading()) {
      // 渲染进程还没加载完：等它加载好再显示（避免 IPC 丢失导致浮层透明）
      const t = setTimeout(() => { try { doShow() } catch (e) { logError('doShow-timeout: ' + e.message) } }, 1500)
      popupWin.webContents.once('did-finish-load', () => { clearTimeout(t); try { doShow() } catch (e) { logError('doShow-after-load: ' + e.message) } })
    } else {
      doShow()
    }
  } catch (e) {
    if (popupState === 'showing') popupState = 'hidden'
    logError('showPopup: ' + (e.stack || e.message))
  }
}

function hidePopup(reason = 'unknown') {
  if (!popupWin || popupState === 'hidden') return
  popupState = 'hidden'
  clearTimeout(blurTimer)
  clearTimeout(hideFallbackTimer)
  if (focusPollTimer) { clearInterval(focusPollTimer); focusPollTimer = null }
  try { if (!popupWin.isMinimized()) popupWin.minimize() } catch (e) { popupWin.hide() }
  logError('popup hidden: ' + reason)
}

function dismissPopup(reason = 'dismiss') {
  if (!popupWin || popupWin.isDestroyed()) return
  popupState = 'hidden'
  clearTimeout(blurTimer)
  clearTimeout(hideFallbackTimer)
  if (focusPollTimer) { clearInterval(focusPollTimer); focusPollTimer = null }
  popupWin.hide()
  logError('popup dismissed: ' + reason)
}

function finishHide(reason = 'renderer') {
  hidePopup(reason)
}

function togglePopup(source = 'unknown') {
  if (!isEnabled) return
  if (popupState === 'visible' || popupState === 'showing') hidePopup(source)
  else showPopup()
}

// ---------- 键盘钩子子进程（低级钩子抢 Win+W） ----------
function startHook() {
  if (!isEnabled || hookProc) return
  const script = scriptPath('hook.ps1')
  if (!fs.existsSync(script)) { logError('hook.ps1 not found: ' + script); return }
  hookProc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true })
  let buf = ''
  hookProc.stdout.on('data', (d) => {
    buf += d.toString()
    const lines = buf.split(/\r?\n/)
    buf = lines.pop()
    for (const l of lines) {
      if (l.trim() === 'toggle') togglePopup()
    }
  })
  hookProc.on('error', (e) => logError('hook spawn error: ' + e.message))
  hookProc.on('exit', (code) => {
    hookProc = null
    logError('hook exited code=' + code + ' (restart in 3s)')
    setTimeout(() => { if (!app.isQuitting && isEnabled) startHook() }, 3000)
  })
}

function stopHook() {
  const proc = hookProc
  hookProc = null
  if (proc) { try { proc.kill() } catch (e) {} }
}

function setEnabled(enabled) {
  isEnabled = Boolean(enabled)
  config.enabled = isEnabled
  saveConfig(config)
  if (isEnabled) startHook()
  else {
    stopHook()
    hidePopup('disabled')
  }
  updateTrayMenu()
}

function updateTrayMenu() {
  if (!tray) return
  tray.setToolTip(`DownloadsDock（${isEnabled ? '已启用' : '已禁用'}）`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '启用 DownloadsDock', type: 'checkbox', checked: isEnabled, click: item => setEnabled(item.checked) },
    { label: isEnabled ? '打开 / 收起浮层' : '打开 / 收起浮层（已禁用）', enabled: isEnabled, click: () => togglePopup('tray-menu') },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]))
}

function createTray() {
  const image = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 20, height: 20 })
  tray = new Tray(image)
  updateTrayMenu()
  tray.on('click', () => { if (isEnabled) togglePopup('tray-click') })
}

// ---------- 目录监视 ----------
function startWatcher() {
  if (watcher) { try { watcher.close() } catch (e) {} }
  if (watchTimer) { clearTimeout(watchTimer); watchTimer = null }
  try {
    watcher = fs.watch(currentPath, () => {
      clearTimeout(watchTimer)
      watchTimer = setTimeout(() => {
        thumbnailCache.clear()
        if (popupWin && popupWin.isVisible()) popupWin.webContents.send('dir-changed')
      }, 250)
    })
  } catch (e) {}
}

// ---------- IPC ----------
ipcMain.handle('list-files', async () => {
  const started = Date.now()
  const result = await listDir(currentPath)
  logError(`list-files: dir=${currentPath} count=${result.items.length} ms=${Date.now() - started}${result.error ? ' error=' + result.error : ''}`)
  return result
})
ipcMain.handle('get-current-dir', () => currentPath)
ipcMain.handle('get-config', () => config)
ipcMain.handle('get-thumbnail', async (_event, filePath, requestedSize = 96) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return ''
    const stat = fs.statSync(filePath)
    const size = Math.max(32, Math.min(256, Number(requestedSize) || 96))
    const key = `${filePath}|${stat.mtimeMs}|${size}`
    if (thumbnailCache.has(key)) return thumbnailCache.get(key)
    let image
    const useContentPreview = stat.isFile() && PREVIEW_EXTENSIONS.has(path.extname(filePath).toLowerCase())
    if (stat.isDirectory() || !useContentPreview) image = await app.getFileIcon(filePath, { size: 'large' })
    else image = await nativeImage.createThumbnailFromPath(filePath, { width: size, height: size })
    if (!image || image.isEmpty()) image = await app.getFileIcon(filePath, { size: 'large' })
    const data = image && !image.isEmpty() ? image.toDataURL() : ''
    thumbnailCache.set(key, data)
    if (thumbnailCache.size > 300) thumbnailCache.delete(thumbnailCache.keys().next().value)
    return data
  } catch (e) {
    try {
      const image = await app.getFileIcon(filePath, { size: 'large' })
      return image && !image.isEmpty() ? image.toDataURL() : ''
    } catch (_) { return '' }
  }
})

ipcMain.on('open-path', (e, p) => {
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) shell.openPath(p)
  else shell.openPath(p)
})

ipcMain.on('enter-dir', (e, p) => { currentPath = p; startWatcher() })
ipcMain.on('navigate-up', (e) => {
  const parent = path.dirname(currentPath)
  if (parent && parent !== currentPath && fs.existsSync(parent)) {
    currentPath = parent
    startWatcher()
  }
})

ipcMain.on('show-in-folder', (e, p) => { shell.showItemInFolder(p) })
ipcMain.on('copy-path', (e, p) => { clipboard.writeText(p) })

ipcMain.on('trash', (e, p) => { shell.trashItem(p) })

ipcMain.handle('rename', async (e, oldP, newName) => {
  const dir = path.dirname(oldP)
  const newP = path.join(dir, newName)
  if (fs.existsSync(newP)) return { ok: false, error: '已存在同名文件' }
  try { fs.renameSync(oldP, newP); return { ok: true, newPath: newP } }
  catch (err) { return { ok: false, error: String(err) } }
})

// 拖拽到外部：全部是文件 → 原生 startDrag（单/多文件，同步无延迟）；含目录 → PowerShell DoDragDrop
ipcMain.on('start-drag', (e, paths) => {
  if (!paths || !paths.length) return
  dragging = true
  let allFiles = true
  for (const p of paths) {
    try { if (!fs.statSync(p).isFile()) { allFiles = false; break } } catch (err) { allFiles = false; break }
  }

  if (allFiles) {
    let icon = nativeImage.createEmpty()
    try {
      const cached = [...thumbnailCache.entries()].find(([key, data]) => typeof key === 'string' && key.startsWith(paths[0] + '|') && data)
      if (cached) icon = nativeImage.createFromDataURL(cached[1])
      if (!icon || icon.isEmpty()) icon = nativeImage.createFromPath(paths[0])
    } catch (err) { logError('drag file icon: ' + err.message) }
    if (!icon || icon.isEmpty()) {
      icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 32, height: 32 })
    }
    try {
      e.sender.startDrag(paths.length === 1 ? { file: paths[0], icon } : { files: paths, icon })
    } catch (err) {
      logError('startDrag failed: ' + (err.stack || err.message))
    }
    dragging = false
    if (popupWin && popupState === 'visible') hidePopup('drag-complete')
  } else {
    const script = scriptPath('drag-helper.ps1')
    if (!fs.existsSync(script)) { dragging = false; logError('drag-helper.ps1 not found: ' + script); return }
    const p = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true })
    p.stdin.write(paths.join('\n'))
    p.stdin.end()
    p.on('error', (e) => { dragging = false; logError('drag helper spawn error: ' + e.message) })
    p.on('exit', () => {
      dragging = false
      if (popupWin && popupWin.isVisible()) hidePopup()
    })
  }
})

// 拖拽调整浮层宽度：主进程轮询屏幕级鼠标坐标（鼠标出窗口也能继续跟踪，变大变小都可靠）
// 注意：起点坐标必须在主进程用 screen.getCursorScreenPoint()（DIP 逻辑像素）读取，
// 不能用渲染进程的 e.screenX（在 DPI 缩放≠100% 时是物理像素，会导致起点偏移、拖窄失效）
let resizeState = null
let resizeTimer = null
ipcMain.on('begin-resize', () => {
  if (resizeTimer) { clearInterval(resizeTimer); resizeTimer = null }
  const p = screen.getCursorScreenPoint()
  resizeState = {
    startX: p.x,
    startW: (popupWin && !popupWin.isDestroyed()) ? popupWin.getSize()[0] : POP_W
  }
  logError(`begin-resize startX=${resizeState.startX} startW=${resizeState.startW}`)
  // resizable:false 的窗口在 Windows 上 setSize 缩小会被系统忽略，
  // 拖拽期间必须先临时设为可调整，结束再锁回
  try { if (popupWin && !popupWin.isDestroyed()) popupWin.setResizable(true) } catch (err) { logError('begin setResizable: ' + err.message) }
  resizeTimer = setInterval(() => {
    if (!popupWin || popupWin.isDestroyed() || !resizeState) { return }
    if (!popupWin.isVisible()) {
      clearInterval(resizeTimer); resizeTimer = null
      resizeState = null
      return
    }
    try {
      const cur = screen.getCursorScreenPoint()
      const w2 = Math.max(MIN_W, Math.min(MAX_W, Math.round(resizeState.startW + (cur.x - resizeState.startX))))
      popupWin.setSize(w2, POP_H)
    } catch (err) { logError('resize poll: ' + err.message) }
  }, 16)
})
ipcMain.on('end-resize', () => {
  if (resizeTimer) { clearInterval(resizeTimer); resizeTimer = null }
  if (resizeState) {
    try {
      const cur = screen.getCursorScreenPoint()
      const w2 = Math.max(MIN_W, Math.min(MAX_W, Math.round(resizeState.startW + (cur.x - resizeState.startX))))
      popupWidth = w2
      config.popupWidth = w2
      saveConfig(config)
      if (popupWin && !popupWin.isDestroyed()) {
        popupWin.setSize(w2, POP_H)
        popupWin.setResizable(false)
      }
      logError(`end-resize w2=${w2}`)
    } catch (err) { logError('end-resize: ' + err.message) }
  }
  resizeState = null
})

// 复制文件/文件夹到剪贴板（CF_HDROP，之后可在资源管理器等 Ctrl+V 粘贴）
ipcMain.on('copy-files', (e, paths) => {
  if (!paths || !paths.length) return
  const script = scriptPath('copy-helper.ps1')
  if (!fs.existsSync(script)) { logError('copy-helper.ps1 not found: ' + script); return }
  const p = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true })
  p.stdin.write(paths.join('\n'))
  p.stdin.end()
  p.on('error', (err) => logError('copy helper spawn error: ' + err.message))
})

// 从剪贴板粘贴文件到当前目录（复制，不剪切）
ipcMain.on('paste-files', (e) => {
  const script = scriptPath('paste-helper.ps1')
  if (!fs.existsSync(script)) { logError('paste-helper.ps1 not found: ' + script); return }
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script]
  const p = spawn('powershell.exe', args, { windowsHide: true })
  let out = ''
  p.stdout.setEncoding('utf8')
  p.stdout.on('data', (d) => { out += d })
  p.on('error', (err) => logError('paste helper spawn error: ' + err.message))
  p.on('exit', () => {
    try {
      const list = JSON.parse(out.trim())
      if (!Array.isArray(list) || !list.length) return
      let copied = 0
      for (const src of list) {
        if (!fs.existsSync(src)) continue
        const name = path.basename(src)
        const ext = path.extname(name)
        const base = path.basename(name, ext)
        let dest = path.join(currentPath, name)
        let i = 2
        while (fs.existsSync(dest)) { dest = path.join(currentPath, `${base} - 副本${i}${ext}`); i++ }
        try {
          fs.cpSync(src, dest, { recursive: true })
          copied++
        } catch (err) { logError('paste copy failed: ' + src + ' -> ' + err.message) }
      }
      if (copied > 0 && popupWin && !popupWin.isDestroyed()) {
        popupWin.webContents.send('dir-changed')
      }
    } catch (err) { logError('paste parse: ' + err.message) }
  })
})

// 右键菜单
ipcMain.on('show-context-menu', (e, items) => {
  const template = []
  if (items.single) {
    template.push({ label: '打开', click: () => shell.openPath(items.paths[0]) })
    template.push({ label: '在资源管理器中显示', click: () => shell.showItemInFolder(items.paths[0]) })
    template.push({ type: 'separator' })
    template.push({ label: '复制路径', click: () => clipboard.writeText(items.paths[0]) })
    template.push({ label: '重命名', click: () => { popupWin.webContents.send('do-rename', items.paths[0]) } })
    template.push({ label: '删除（回收站）', click: () => shell.trashItem(items.paths[0]) })
  } else {
    template.push({ label: `打开 ${items.paths.length} 项`, click: () => items.paths.forEach(p => shell.openPath(p)) })
    template.push({ type: 'separator' })
    template.push({ label: `删除 ${items.paths.length} 项（回收站）`, click: () => items.paths.forEach(p => shell.trashItem(p)) })
  }
  template.push({ type: 'separator' })
  template.push({ label: '刷新', click: () => popupWin.webContents.send('dir-changed') })
  const menu = Menu.buildFromTemplate(template)
  menu.popup({ window: popupWin })
})

// 设置菜单（顶栏 ☰）
ipcMain.on('show-settings-menu', () => {
  const template = [
    { label: '更改文件夹…', click: async () => {
      const r = await dialog.showOpenDialog(popupWin, { properties: ['openDirectory'] })
      if (!r.canceled && r.filePaths[0]) {
        currentPath = r.filePaths[0]
        config.downloadPath = currentPath
        saveConfig(config)
        startWatcher()
        popupWin.webContents.send('dir-changed')
      }
    }},
    { label: '开机自启', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked }) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]
  Menu.buildFromTemplate(template).popup({ window: popupWin })
})

ipcMain.on('hide-done', () => {
  logError('hide-done received')
  dismissPopup('close-button')
})

// ---------- 生命周期 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => { togglePopup() })
  app.on('ready', () => {
    try {
      createPopup()
      createTray()
      if (isEnabled) startHook()
      startWatcher()
      appReady = true
      // 启动后自动弹出浮层，让用户立即看到效果（点别处 / Win+W / Esc 收起）
      if (isEnabled) setTimeout(() => { try { showPopup() } catch (e) { logError('auto showPopup: ' + (e.stack || e.message)) } }, 350)
    } catch (e) {
      logError('ready handler: ' + (e.stack || e.message))
    }
  })
  app.on('before-quit', () => {
    app.isQuitting = true
    stopHook()
    if (watcher) { try { watcher.close() } catch (e) {} }
  })
  app.on('window-all-closed', (e) => {
    // 保持常驻（任务栏锚点），不退出
  })
}
