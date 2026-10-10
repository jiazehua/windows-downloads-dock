// ============================================================
//  DownloadsDock × ClipShelf — 合并版主进程
//  一个窗口、左右两栏：
//    左栏 = 下载浮层（DownloadsDock）
//    右栏 = 最近图片 + 暂存架（ClipShelf）
//  快捷键 Ctrl+Shift+V（低级键盘钩子，见 hook.ps1），
//  窗口出现在「鼠标所在的那块屏幕」的鼠标位置。
// ============================================================
const { app, BrowserWindow, ipcMain, shell, clipboard, screen, dialog, Menu, nativeImage, Tray } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { spawn } = require('child_process')
const { FileShelf } = require('./clipshelf/file-shelf')

const APP_ID = 'com.chuanshanjia.downloadsdock'
app.setAppUserModelId(APP_ID)

// ---------- 尺寸 ----------
const POP_W = 484          // 下载栏「窗口宽」（含 body 左右各 12px 内边距）
const POP_H = 628          // 整个窗口的高度
const MIN_W = 320
const MAX_W = 900
const CLIP_W = 388         // 右栏「最近图片」固定宽度
const GAP = 8              // 两栏之间的间隙（下载栏的拖宽手柄正好落在这里）
const SHELF_MIN = 280
const SHELF_MAX = 760
const CLIP_WINDOW_MIN = 388

// ---------- 截图 ----------
const SHOT_NAME = /^Screenshot_\d{8}_\d{6}_\d{3}_[A-F0-9]{8}\.png$/
const POLL_MS = 800

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

// 能被「解压缩」识别的后缀。zip 走系统自带 Expand-Archive，其余交给 7-Zip（若装了）。
const ARCHIVE_EXTS = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.bz2', '.xz', '.tgz'])

let popupWin = null
let previewWin = null
let tray = null
let hookProc = null
let fileShelf = null
let dragging = false
let appReady = false
let currentPath = ''
let iconCache = {}
let watcher = null
let watchTimer = null
const thumbnailCache = new Map()
const PREVIEW_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.heic', '.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.pdf'])
let focusPollTimer = null
let unfocusedSamples = 0
let everFocused = false
let popupState = 'hidden'
let hideFallbackTimer = null
// 主进程发起收起时，等渲染层播完退场动画后要执行的动作（见 hidePopup）
let pendingHide = null
let blurTimer = null
let isEnabled = true
let showTime = 0

// ClipShelf 侧状态
let pinned = false          // 「置顶（固定）」——默认关闭，不写进配置
let shelfOpen = false
let shelfModalDepth = 0     // 打开的菜单 / 确认框数量，>0 时不因失焦而收起
let choosingFolder = false
let previewRequest = 0
let polling = false
let lastHash = null
let cleanTimer = null

// ---------- 配置 ----------
const cfgPath = path.join(app.getPath('userData'), 'config.json')
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) } catch (e) { return {} }
}
function saveConfig() {
  try { fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2)) } catch (e) {}
}
let config = loadConfig()
isEnabled = config.enabled !== false
let popupWidth = Math.max(MIN_W, Math.min(MAX_W, Number(config.popupWidth) || POP_W))
let shelfWidth = Math.max(SHELF_MIN, Math.min(SHELF_MAX, Number(config.shelfWidth) || 380))
const defaultShotFolder = () => path.join(app.getPath('pictures'), 'ClipShelf')
let retentionDays = Number.isInteger(config.retentionDays) ? Math.min(3650, Math.max(0, config.retentionDays)) : 30
let shotFolder = (typeof config.clipFolder === 'string' && config.clipFolder.trim()) ? config.clipFolder : defaultShotFolder()
// 用户手动拖拽排出来的图片顺序（绝对路径数组，按显示顺序）。
// 只在用户真的拖过一次之后才非空——空数组时完全走原来的「按时间倒序」。
let clipOrder = Array.isArray(config.clipOrder) ? config.clipOrder.filter(p => typeof p === 'string') : []

function defaultDownload() {
  const h = app.getPath('downloads')
  try { return fs.existsSync(h) ? h : app.getPath('documents') } catch (e) { return app.getPath('home') }
}
currentPath = (config.downloadPath && fs.existsSync(config.downloadPath)) ? config.downloadPath : defaultDownload()

// 右侧面板下发给渲染进程的设置快照（字段名沿用 ClipShelf 的 settings 结构）
function clipSettings() {
  return { folder: shotFolder, retentionDays, shelfWidth }
}

// ============================================================
//  左栏：下载浮层
// ============================================================

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

// ============================================================
//  右栏：ClipShelf（最近图片）
// ============================================================

function ensureShotFolder() {
  try { fs.mkdirSync(shotFolder, { recursive: true }) } catch (e) { logError('ensureShotFolder: ' + e.message) }
}

function trustedShot(file) {
  return typeof file === 'string'
    && path.dirname(path.resolve(file)) === path.resolve(shotFolder)
    && SHOT_NAME.test(path.basename(file))
    && fs.existsSync(file)
}

function cleanOldFiles() {
  if (retentionDays === 0) return
  const cutoff = Date.now() - retentionDays * 86400000
  try {
    for (const name of fs.readdirSync(shotFolder)) {
      if (!SHOT_NAME.test(name)) continue
      const file = path.join(shotFolder, name)
      try {
        if (fs.statSync(file).birthtimeMs < cutoff) fs.unlinkSync(file)
      } catch (e) { logError('cleanOldFiles unlink: ' + e.message) }
    }
  } catch (e) { logError('cleanOldFiles scan: ' + e.message) }
  // 手动顺序里已经被清掉的文件要一起摘掉，否则 config.json 会无限变长
  if (clipOrder.length) {
    const kept = clipOrder.filter(file => { try { return fs.existsSync(file) } catch (e) { return false } })
    if (kept.length !== clipOrder.length) {
      clipOrder = kept
      config.clipOrder = kept
      saveConfig()
    }
  }
}

function thumbnail(file, width) {
  try {
    const source = nativeImage.createFromPath(file)
    if (source.isEmpty()) return null
    return source.resize({ width, quality: 'good' }).toDataURL()
  } catch (e) { return null }
}

// ⚠️ 缩略图必须缓存：nativeImage.createFromPath + resize + toDataURL 是同步阻塞的，
// 60 张截图重算一次会把主进程卡住约 0.6 秒 —— 期间热键、托盘、窗口都无响应。
// 每次显示浮层都会走一遍 sendState()，所以这里的缓存不是「优化」而是「必须」。
const shotThumbCache = new Map()   // file -> { mtimeMs, data }

function shots() {
  let names
  try { names = fs.readdirSync(shotFolder).filter(name => SHOT_NAME.test(name)) } catch (e) { return [] }
  const entries = []
  for (const name of names) {
    const file = path.join(shotFolder, name)
    try {
      const st = fs.statSync(file)
      entries.push({ file, date: st.birthtimeMs, mtimeMs: st.mtimeMs })
    } catch (e) { /* 正在被清理，跳过 */ }
  }
  entries.sort((a, b) => b.date - a.date)
  // 手动排序优先：进了 clipOrder 的按用户拖出来的次序；没进的（刚截的新图）
  // 一律排到它们前面，且内部仍按时间倒序 —— 这样新截图永远出现在最前，
  // 不会因为「用户排过序」就被挤到 60 张可见范围之外。
  // （Array#sort 在 V8 里是稳定的，所以相等分支会保序。）
  if (clipOrder.length) {
    const rank = new Map()
    clipOrder.forEach((file, index) => rank.set(file, index))
    entries.sort((a, b) => {
      const ra = rank.has(a.file) ? rank.get(a.file) : -1
      const rb = rank.has(b.file) ? rank.get(b.file) : -1
      if (ra >= 0 && rb >= 0) return ra - rb
      if (ra >= 0) return 1
      if (rb >= 0) return -1
      return b.date - a.date
    })
  }
  const out = []
  for (const entry of entries.slice(0, 60)) {
    const cached = shotThumbCache.get(entry.file)
    if (cached && cached.mtimeMs === entry.mtimeMs) {
      out.push({ file: entry.file, date: entry.date, image: cached.data })
      continue
    }
    const image = thumbnail(entry.file, 330)
    if (!image) continue
    shotThumbCache.set(entry.file, { mtimeMs: entry.mtimeMs, data: image })
    out.push({ file: entry.file, date: entry.date, image })
  }
  // 目录里删掉的文件（自动清理 / 手动删除）顺手从缓存里摘掉，避免长期驻留
  if (shotThumbCache.size > 200) {
    const alive = new Set(entries.map(e => e.file))
    for (const key of [...shotThumbCache.keys()]) if (!alive.has(key)) shotThumbCache.delete(key)
  }
  return out
}

function sendState() {
  if (popupWin && !popupWin.isDestroyed() && !popupWin.webContents.isLoading()) {
    const started = Date.now()
    popupWin.webContents.send('state', { shots: shots(), settings: clipSettings(), pinned, shelfOpen })
    const cost = Date.now() - started
    // 正常应在 10ms 量级；上百毫秒说明缩略图缓存失效了（会把主进程卡住）
    if (cost > 120) logError(`sendState slow: ${cost}ms`)
  }
}

// Windows 剪贴板里放着「文件」时不要去当图片扫描：
// 资源管理器「复制图片文件」同时会带一个 CF_BITMAP 缩略图，
// 不做这个判断会把每次复制文件都存成一张假截图。
function clipboardHasFiles() {
  const formats = ['FileNameW', 'FileName', 'CF_HDROP', 'FileNameA']
  for (const format of formats) {
    try {
      const buf = clipboard.readBuffer(format)
      if (buf && buf.length) return true
    } catch (e) { /* 该格式不存在 */ }
  }
  return false
}

// Windows 下不需要 macOS 那套 public.file-url / osclipboard 私有格式，
// Electron 的 clipboard.readImage() 直接就能拿到位图。
function pollClipboard() {
  if (polling) return
  polling = true
  try {
    if (clipboardHasFiles()) { lastHash = null; return }
    const image = clipboard.readImage()
    if (!image || image.isEmpty()) { lastHash = null; return }
    let bytes = image.toPNG()
    if (!bytes || !bytes.length) return
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase()
    if (hash === lastHash) return
    ensureShotFolder()
    const now = new Date()
    const pad = (n, len = 2) => String(n).padStart(len, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${pad(now.getMilliseconds(), 3)}`
    const file = path.join(shotFolder, `Screenshot_${stamp}_${hash.slice(0, 8)}.png`)
    fs.writeFileSync(file, bytes)
    lastHash = hash
    cleanOldFiles()
    sendState()
  } catch (e) {
    logError('pollClipboard: ' + e.message)
  } finally {
    polling = false
  }
}

function hidePreview() {
  previewRequest++
  if (previewWin && !previewWin.isDestroyed()) {
    if (previewWin.isVisible()) logError('preview hide')
    previewWin.hide()
  }
}

function showPreview(file) {
  if (!trustedShot(file) || !popupWin || popupWin.isDestroyed() || !popupWin.isVisible()) return
  const request = ++previewRequest
  const image = nativeImage.createFromPath(file)
  if (image.isEmpty()) return
  const size = image.getSize()
  const point = screen.getCursorScreenPoint()
  const area = screen.getDisplayNearestPoint(point).workArea
  const factor = Math.min(1, 500 / size.width, 380 / size.height)
  const width = Math.max(120, Math.round(size.width * factor))
  const height = Math.max(80, Math.round(size.height * factor))
  const outerWidth = width + 32
  const outerHeight = height + 64
  if (!previewWin || previewWin.isDestroyed()) {
    previewWin = new BrowserWindow({
      width: outerWidth, height: outerHeight, show: false,
      frame: false, transparent: true, hasShadow: true, focusable: false,
      alwaysOnTop: true, skipTaskbar: true, resizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false, contextIsolation: true, sandbox: true
      }
    })
    previewWin.setIgnoreMouseEvents(true)
    previewWin.loadFile(path.join(__dirname, 'renderer', 'preview.html'))
  } else {
    previewWin.setSize(outerWidth, outerHeight)
  }
  const bounds = popupWin.getBounds()
  const right = bounds.x + bounds.width + 10
  const left = bounds.x - outerWidth - 10
  const x = right + outerWidth <= area.x + area.width ? right
    : left >= area.x ? left
    : Math.min(Math.max(point.x - outerWidth / 2, area.x), area.x + area.width - outerWidth)
  const y = Math.min(Math.max(point.y - 65, area.y), area.y + area.height - outerHeight)
  previewWin.setPosition(Math.round(x), Math.round(y))
  let stat = null
  try { stat = fs.statSync(file) } catch (e) {}
  const data = {
    src: image.resize({ width, height, quality: 'good' }).toDataURL(),
    width, height,
    originalWidth: size.width, originalHeight: size.height,
    date: stat ? stat.birthtimeMs : Date.now()
  }
  const render = () => {
    if (request !== previewRequest || !popupWin.isVisible() || !previewWin || previewWin.isDestroyed()) {
      logError(`preview skipped: stale=${request !== previewRequest} popupVisible=${popupWin.isVisible()}`)
      return
    }
    previewWin.webContents.send('preview-data', data)
    previewWin.showInactive()
    logError(`preview show: ${path.basename(file)} ${width}x${height} (原图 ${size.width}x${size.height}) at=${Math.round(x)},${Math.round(y)}`)
  }
  if (previewWin.webContents.isLoading()) previewWin.webContents.once('did-finish-load', render)
  else render()
}

// ============================================================
//  主窗口（左右两栏）
// ============================================================

// 窗口总宽 = 下载栏「窗口宽」 + 间隙 + 右栏（388 + 暂存架宽度）
function totalWidth() {
  return Math.round(popupWidth) + GAP + CLIP_W + (shelfOpen ? Math.round(shelfWidth) : 0)
}

function applySize(w, h) {
  if (!popupWin || popupWin.isDestroyed()) return
  w = Math.round(w); h = Math.round(h)
  // 尺寸没变就什么都别做：Windows 上给 frameless 窗口临时打开 resizable
  // 会引入一圈不可见的 WS_THICKFRAME 边框，客户区会莫名缩掉几个像素，
  // 每次显示都白折腾一遍会让两栏比预期窄一点点。
  try {
    const [cw, ch] = popupWin.getSize()
    if (cw === w && ch === h) return
  } catch (e) {}
  try {
    const wasResizable = popupWin.isResizable()
    if (!wasResizable) popupWin.setResizable(true)
    popupWin.setSize(w, h)
    if (!wasResizable) popupWin.setResizable(false)
  } catch (e) { logError('applySize: ' + e.message) }
}

function createPopup() {
  popupState = 'hidden'
  popupWin = new BrowserWindow({
    title: '\u200B',
    width: totalWidth(), height: POP_H,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    // 任务栏按钮**动态**跟着浮层走（见 syncTaskbar）。这里给初始值 true = 平时不占。
    // 之前锚点窗口常驻任务栏的那套已整个移除，原因见上面 createAnchor 位置的注释。
    skipTaskbar: true,
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
  popupWin.webContents.on('did-finish-load', () => sendState())
  // 注意：level 参数仅 macOS 支持，Windows 上传入会抛异常导致后续初始化中断
  try { popupWin.setAlwaysOnTop(true) } catch (e) { logError('setAlwaysOnTop: ' + e.message) }

  popupWin.on('blur', () => {
    if (dragging || popupState !== 'visible' || Date.now() - showTime < 250) return
    // 「固定」时不因失焦收起；菜单/对话框打开时也不收
    if (pinned || shelfModalDepth > 0 || choosingFolder) return
    hidePopup('blur')
  })
  popupWin.on('minimize', () => {
    hidePreview()
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
    logError('popup closed（窗口被销毁）')
    popupWin = null
    popupState = 'hidden'
    hidePreview()
  })
}

// 锚点窗口已移除（v2.1.2）。
//
// 它原本是一个 1x1 的透明窗口，唯一作用就是让 Windows 在任务栏上留一个按钮，
// 用户点那个按钮能唤出浮层。但用户明确要求「平时任务栏不要有东西，只有按快捷键
// 呼出浮层时任务栏才出现，收起后任务栏就没东西」—— 这与「常驻锚点」在语义上
// 无法共存：常驻锚点必然在任务栏上留一个图标。
//
// 现在的分工：
//   · 日常 → 任务栏**空**，只有托盘图标（托盘永远在，呼出能力不缺）
//   · 浮层弹出 → 任务栏出现它自己的按钮（popupWin 的 skipTaskbar 动态切换）
//   · 浮层收起 → 按钮消失，任务栏回到空
//
// ⚠️ 不要再把 anchorWin 加回来：它和用户要的「任务栏平时是空的」直接冲突。

// ---------- 显示 / 隐藏 ----------

function positionPopup() {
  // 多屏：窗口要出现在鼠标当前所在的那块屏上（托盘 / 任务栏 / 快捷键都可能在任何一块屏触发）。
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const area = display.workArea
  // 屏幕装不下时压缩下载栏宽度（右栏是固定宽度，不参与压缩）
  const width = Math.min(totalWidth(), area.width)
  const height = Math.min(POP_H, area.height)
  // ⚠️ 关键顺序：Windows 会直接忽略对「已最小化」窗口的 SetWindowPos / SetWindowSize。
  // 浮层的隐藏走的是 minimize()，所以定位前必须先 restore()，否则尺寸与位置全都无效，
  // 窗口会一直停在上一次最小化之前的位置 —— 表现就是不管鼠标在哪块屏，浮层都固定出现在同一块屏。
  // restore 之后立刻 hide()，是为了避免在旧位置闪一帧；对已隐藏的窗口 setPosition 依然有效。
  // 顺序不可改成 setPosition → restore（那样 restore 会把窗口又拉回原位，等于没修）。
  if (popupWin.isMinimized()) {
    try {
      popupWin.restore()
      popupWin.hide()
    } catch (e) { logError('positionPopup un-minimize: ' + e.message) }
  }
  applySize(width, height)
  // 跟随鼠标：从鼠标右下方 12px 处开始，超出工作区就贴边（ClipShelf 原本的定位逻辑）
  const x = Math.max(area.x, Math.min(cursor.x + 12, area.x + area.width - width))
  const y = Math.max(area.y, Math.min(cursor.y + 12, area.y + area.height - height))
  popupWin.setPosition(Math.round(x), Math.round(y), false)
  let actual = [x, y]
  try { actual = popupWin.getPosition() } catch (e) {}
  logError(`popup position: want=${x},${y} actual=${actual[0]},${actual[1]} size=${width}x${height} display=${display.id} cursor=${cursor.x},${cursor.y} scale=${display.scaleFactor}`)
}

// 任务栏按钮跟着浮层显隐走：显示 → 进任务栏；收起 → 从任务栏撤掉。
// 这样「平时任务栏上什么都没有，按 Ctrl+Shift+V 才有」。
//
// ⚠️ 必须在窗口**显示之后**再设 false。Windows 不给「当前不可见」的窗口建任务栏按钮，
//    在 show() 之前设 false 是白设（这就是之前不得不搞一个常驻锚点窗口的原因）。
//    反过来收起时先把窗口隐藏、再设 true，按钮才会立刻消失。
function syncTaskbar (onTaskbar) {
  if (!popupWin || popupWin.isDestroyed()) return
  try {
    popupWin.setSkipTaskbar(!onTaskbar)
    logError(`taskbar ${onTaskbar ? 'show' : 'hide'}`)
  } catch (e) {
    logError('setSkipTaskbar: ' + e.message)
  }
}

function doShow() {
  if (!isEnabled || !popupWin || popupWin.isDestroyed() || popupState === 'visible') return
  clearTimeout(blurTimer)
  // 作废上一次还没走完的收起流程：否则用户在退场动画那 200ms 内又按了快捷键，
  // 260ms 的兜底计时器会在窗口已经显示之后把它收掉。
  clearTimeout(hideFallbackTimer)
  pendingHide = null
  popupState = 'showing'
  try { if (popupWin.isMinimized()) popupWin.restore() } catch (e) {}
  popupWin.show()
  // show() 之后再让它进任务栏，否则 Windows 不会建按钮（见 syncTaskbar 注释）
  syncTaskbar(true)
  popupWin.focus()
  // showTime 记在 focus() 之后：失焦保护窗口（250ms）要从「窗口真正拿到焦点」起算，
  // 否则中间一旦有耗时操作（比如生成缩略图），保护窗口会在 show() 那一刻就被消耗掉。
  showTime = Date.now()
  popupState = 'visible'
  startFocusPolling()
  popupWin.webContents.send('popup-show', { dir: currentPath })
  sendState()
  if (shelfOpen && fileShelf) fileShelf.refresh()
  // Make visibility deterministic even if the initial IPC message arrives
  // before renderer listeners are attached.  顺带把两栏的实际尺寸和 get-state 的
  // 往返结果写进日志，打包后排查「某一栏没宽度 / 布局塌掉 / 状态通道没通」时一眼就能看出来。
  popupWin.webContents.executeJavaScript(`(async () => {
    const app = document.getElementById('app')
    const el = document.getElementById('popup')
    if (app) app.classList.add('visible')
    if (el) el.classList.add('visible')
    const box = id => {
      const node = document.getElementById(id)
      if (!node) return id + '=missing'
      const r = node.getBoundingClientRect()
      return id + '=' + Math.round(r.width) + 'x' + Math.round(r.height)
    }
    let state = 'n/a'
    try {
      const v = await window.shelf.getState()
      state = (v && typeof v === 'object') ? Object.keys(v).join(',') : String(v)
    } catch (e) { state = 'ERR ' + e.message }
    const count = sel => document.querySelectorAll(sel).length
    await new Promise(resolve => setTimeout(resolve, 700))
    return 'visible; dock=' + typeof window.dock + ' shelf=' + typeof window.shelf
      + ' ' + box('popup') + ' ' + box('clipPane') + ' ' + box('file-shelf')
      + ' inner=' + window.innerWidth + 'x' + window.innerHeight
      + ' | getState -> ' + state
      + ' | dockItems=' + count('#list .item') + ' cards=' + count('#grid .card')
  })()`).then(result => logError('renderer state: ' + result))
    .catch(err => logError('renderer show failed: ' + err.message))
  logError('popup shown')
}

function startFocusPolling() {
  if (focusPollTimer) clearInterval(focusPollTimer)
  unfocusedSamples = 0
  everFocused = false
  focusPollTimer = setInterval(() => {
    if (!popupWin || popupState === 'hidden' || !popupWin.isVisible()) {
      clearInterval(focusPollTimer)
      focusPollTimer = null
      return
    }
    if (pinned || dragging || shelfModalDepth > 0 || choosingFolder) { unfocusedSamples = 0; return }
    if (popupState !== 'visible' || Date.now() - showTime < 300) return
    if (popupWin.isFocused()) {
      everFocused = true
      unfocusedSamples = 0
      return
    }
    // ⚠️ 还没拿到过焦点就先别收：快捷键是外部 powershell 进程吞键后通知我们弹出的，
    // Windows 有可能拒绝把前台交给一个「没有收到过输入」的进程。那种情况下窗口会显示
    // 但没有焦点，若照着 isFocused()==false 去收，表现就是「按了 Ctrl+Shift+V 一闪就没了」。
    // 真·失焦（用户点了别处）一定会先触发 popupWin 的 blur 事件，那条路不受影响。
    if (!everFocused) { unfocusedSamples = 0; return }
    if (++unfocusedSamples >= 2) hidePopup('focus-poll')
  }, 60)
}

function showPopup() {
  if (!isEnabled) return
  if (popupState === 'visible') {
    // 已经显示（多半因为「固定」）：把焦点要回来即可，不做重定位，避免窗口乱跳
    try { popupWin.focus() } catch (e) {}
    return
  }
  if (popupState === 'showing') return
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
  hidePreview()
  logError('popup hidden: ' + reason)
  // 先让渲染层把退场动画（#app 的 opacity 0，200ms）播完，它播完会回调 hide-done，
  // 我们再真正把窗口收起来。
  // ⚠️ 兜底计时器不能省：渲染层可能正在加载 / 渲染进程卡住 / 定时器被节流，
  //    一旦收不到 hide-done，窗口就会永远停在屏幕上收不掉 —— 那比「没有退场动画」严重得多。
  let settled = false
  const finish = () => {
    if (settled || !popupWin || popupWin.isDestroyed()) return
    settled = true
    pendingHide = null
    try { if (!popupWin.isMinimized()) popupWin.minimize() } catch (e) { popupWin.hide() }
    // ⚠️ 顺序：先 minimize/hide 再撤任务栏按钮。反过来的话 Windows 会保留按钮
    //    （它只在窗口隐藏时才回收按钮），表现就是「关掉了图标还在」。
    syncTaskbar(false)
  }
  pendingHide = finish
  try { popupWin.webContents.send('popup-hide') } catch (e) { finish() }
  // 动画 200ms，留一点余量
  hideFallbackTimer = setTimeout(finish, 260)
}

function dismissPopup(reason = 'dismiss') {
  if (!popupWin || popupWin.isDestroyed()) return
  popupState = 'hidden'
  clearTimeout(blurTimer)
  clearTimeout(hideFallbackTimer)
  pendingHide = null
  if (focusPollTimer) { clearInterval(focusPollTimer); focusPollTimer = null }
  hidePreview()
  popupWin.hide()
  syncTaskbar(false)
  logError('popup dismissed: ' + reason)
}

function togglePopup(source = 'unknown') {
  if (!isEnabled) return
  // 「固定」时快捷键只负责把窗口叫回来，不负责收起（与 ClipShelf 行为一致）
  if ((popupState === 'visible' || popupState === 'showing') && !pinned) hidePopup(source)
  else showPopup()
}

// ============================================================
//  键盘钩子子进程（低级钩子抢 Ctrl+Shift+V）
// ============================================================
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
      if (l.trim() === 'toggle') togglePopup('hotkey')
    }
  })
  hookProc.on('error', (e) => logError('hook spawn error: ' + e.message))
  // 钩子脚本是 Powershell 编译 C# 实现的，失败时只会往 stderr 吐信息；
  // 不打出来的话日志里只剩一句「hook exited code=1」，完全查不出原因。
  try {
    hookProc.stderr.setEncoding('utf8')
    hookProc.stderr.on('data', (d) => {
      const text = String(d).trim()
      if (text) logError('hook stderr: ' + text.slice(0, 500))
    })
  } catch (e) {}
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
  saveConfig()
  if (isEnabled) startHook()
  else {
    stopHook()
    hidePopup('disabled')
  }
  updateTrayMenu()
}

// ---------- 托盘 ----------
function updateTrayMenu() {
  if (!tray) return
  tray.setToolTip(`下载浮窗 + 最近图片（${isEnabled ? 'Ctrl+Shift+V' : '已禁用'}）`)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '启用（Ctrl+Shift+V）', type: 'checkbox', checked: isEnabled, click: item => setEnabled(item.checked) },
    { label: isEnabled ? '打开 / 收起浮窗' : '打开 / 收起浮窗（已禁用）', enabled: isEnabled, click: () => togglePopup('tray-menu') },
    { label: '固定窗口（不随失焦收起）', type: 'checkbox', checked: pinned, click: item => setPinned(item.checked) },
    { type: 'separator' },
    { label: '打开下载文件夹', click: () => shell.openPath(currentPath) },
    { label: '打开截图文件夹', click: () => { ensureShotFolder(); shell.openPath(shotFolder) } },
    { label: '打开暂存文件夹', click: () => { if (fileShelf) shell.openPath(fileShelf.store.root) } },
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

function setPinned(value) {
  pinned = Boolean(value)
  if (!pinned && popupWin && !popupWin.isDestroyed() && popupState === 'visible' && !popupWin.isFocused()) {
    // 取消固定时如果焦点已经不在窗口上，就别让它继续赖着
    hidePopup('unpinned')
  }
  sendState()
  updateTrayMenu()
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

// ============================================================
//  IPC — 左栏（下载浮层）
// ============================================================
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

ipcMain.on('enter-dir', (e, p) => {
  // ⚠️ 必须校验：渲染层是从 DOM 的 dataset 里取路径再传过来的，
  // 一旦拿到 undefined / 已删除的路径，直接赋值会把 currentPath 写成垃圾值，
  // 目录列表立刻变空，而且没有任何错误提示，看起来就像「浮窗坏了」。
  if (typeof p !== 'string' || !p) { logError('enter-dir 忽略非法路径: ' + String(p)); return }
  try {
    if (!fs.statSync(p).isDirectory()) { logError('enter-dir 不是目录: ' + p); return }
  } catch (err) {
    logError('enter-dir 路径不可用: ' + p + ' / ' + err.message)
    return
  }
  currentPath = p
  startWatcher()
})
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
      if (popupWin && popupWin.isVisible()) hidePopup('drag-complete')
    })
  }
})

// 拖拽调整「下载栏」宽度：主进程轮询屏幕级鼠标坐标（鼠标出窗口也能继续跟踪，变大变小都可靠）
// 注意：起点坐标必须在主进程用 screen.getCursorScreenPoint()（DIP 逻辑像素）读取，
// 不能用渲染进程的 e.screenX（在 DPI 缩放≠100% 时是物理像素，会导致起点偏移、拖窄失效）
let resizeState = null
let resizeTimer = null
ipcMain.on('begin-resize', () => {
  if (resizeTimer) { clearInterval(resizeTimer); resizeTimer = null }
  const p = screen.getCursorScreenPoint()
  // ⚠️ 手柄拖的是「下载栏宽度」，但 getSize() 给的是「整个窗口宽度」。
  // 合并成双栏后这两者不再相等：必须减去间隙 + 右栏，否则一起手就把下载栏
  // 撑成「原窗口宽」，窗口瞬间爆宽（实测直接顶到 MAX_W）。
  const winW = (popupWin && !popupWin.isDestroyed()) ? popupWin.getSize()[0] : totalWidth()
  const dockNow = Math.round(winW - GAP - CLIP_W - (shelfOpen ? Math.round(shelfWidth) : 0))
  resizeState = {
    startX: p.x,
    startW: Math.max(MIN_W, Math.min(MAX_W, dockNow))
  }
  logError(`begin-resize startX=${resizeState.startX} startW=${resizeState.startW} winW=${winW}`)
  // resizable:false 的窗口在 Windows 上 setSize 会被系统忽略，
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
      // 手柄拖的是「下载栏窗口宽」，所以先算出下载栏宽度，再补上右栏
      const dockW = Math.max(MIN_W, Math.min(MAX_W, Math.round(resizeState.startW + (cur.x - resizeState.startX))))
      const w = dockW + GAP + CLIP_W + (shelfOpen ? Math.round(shelfWidth) : 0)
      popupWin.setSize(w, POP_H)
    } catch (err) { logError('resize poll: ' + err.message) }
  }, 16)
})
ipcMain.on('end-resize', () => {
  if (resizeTimer) { clearInterval(resizeTimer); resizeTimer = null }
  if (resizeState) {
    try {
      const cur = screen.getCursorScreenPoint()
      popupWidth = Math.max(MIN_W, Math.min(MAX_W, Math.round(resizeState.startW + (cur.x - resizeState.startX))))
      config.popupWidth = popupWidth
      saveConfig()
      if (popupWin && !popupWin.isDestroyed()) {
        const w = Math.min(screen.getDisplayMatching(popupWin.getBounds()).workArea.width, totalWidth())
        popupWin.setSize(w, POP_H)
        popupWin.setResizable(false)
        // 拖宽后可能顶出屏幕右缘，收尾时贴一次边（拖动过程中不插手，免得跟用户的手感打架）
        const bounds = popupWin.getBounds()
        const area = screen.getDisplayMatching(bounds).workArea
        const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - w))
        if (Math.round(x) !== bounds.x) popupWin.setPosition(Math.round(x), bounds.y, false)
      }
      logError(`end-resize popupWidth=${popupWidth}`)
    } catch (err) { logError('end-resize: ' + err.message) }
  }
  resizeState = null
})

// 把路径写进系统剪贴板（CF_HDROP），cut=true 时带 MOVE 标记 → 粘贴方会执行「移动」。
// 复制和剪切的差别只在 helper 脚本：copy-helper.ps1 只写文件列表，
// cut-helper.ps1 额外写 Preferred DropEffect=2。
function writeClipboard (paths, cut) {
  if (!paths || !paths.length) return
  const name = cut ? 'cut-helper.ps1' : 'copy-helper.ps1'
  const script = scriptPath(name)
  if (!fs.existsSync(script)) { logError(name + ' not found: ' + script); return }
  const p = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true })
  p.stdin.write(paths.join('\n'))
  p.stdin.end()
  p.on('error', (err) => logError((cut ? 'cut' : 'copy') + ' helper spawn error: ' + err.message))
}

// 复制文件/文件夹到剪贴板（CF_HDROP，之后可在资源管理器等 Ctrl+V 粘贴）
ipcMain.on('copy-files', (e, paths) => { writeClipboard(paths, false) })

// 剪切文件/文件夹到剪贴板（CF_HDROP + Preferred DropEffect=MOVE）
// 和在资源管理器里按 Ctrl+X 等价，粘到别处是「移动」，粘回原目录则什么都不做。
ipcMain.on('cut-files', (e, paths) => { writeClipboard(paths, true) })

// 解压到当前目录下的同名文件夹（供右键菜单和 IPC 共用）
async function extractArchiveTo (filePath) {
  if (typeof filePath !== 'string' || !filePath) return { ok: false, error: '路径无效' }
  try {
    if (!fs.statSync(filePath).isFile()) return { ok: false, error: '不是文件' }
  } catch (err) { return { ok: false, error: '文件不可用' } }

  const ext = path.extname(filePath).toLowerCase()
  if (!ARCHIVE_EXTS.has(ext)) return { ok: false, error: '不支持的压缩格式' }

  const name = path.basename(filePath, ext)
  let outDir = path.join(path.dirname(filePath), name)
  // 目标文件夹已存在时不覆盖，加序号 —— 直接解到已有文件夹里会把人家内容搞乱
  let i = 2
  while (fs.existsSync(outDir)) { outDir = path.join(path.dirname(filePath), `${name} (${i})`); i++ }

  if (ext === '.zip') {
    return new Promise(resolve => {
      const script = scriptPath('extract-helper.ps1')
      if (!fs.existsSync(script)) { resolve({ ok: false, error: '缺少 extract-helper.ps1' }); return }
      const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true })
      p.stdin.write(filePath + '\n' + outDir + '\n')
      p.stdin.end()
      let err = ''
      p.stderr.setEncoding('utf8')
      p.stderr.on('data', d => { err += d })
      p.on('error', e2 => resolve({ ok: false, error: e2.message }))
      p.on('exit', code => {
        if (code === 0 && fs.existsSync(outDir)) {
          logError('extract ok: ' + path.basename(filePath) + ' -> ' + outDir)
          resolve({ ok: true, outDir })
        } else {
          logError('extract failed: code=' + code + ' ' + err.slice(0, 300))
          resolve({ ok: false, error: (err || '解压失败').trim().slice(0, 200) })
        }
      })
    })
  }

  const sevenZip = findSevenZip()
  if (!sevenZip) return { ok: false, error: '解压 ' + ext + ' 需要装 7-Zip，本机没找到' }
  return new Promise(resolve => {
    const p = spawn(sevenZip, ['x', filePath, '-o' + outDir, '-y'], { windowsHide: true })
    let err = ''
    p.stderr.setEncoding('utf8')
    p.stderr.on('data', d => { err += d })
    p.on('error', e2 => resolve({ ok: false, error: e2.message }))
    p.on('exit', code => {
      if (code === 0) resolve({ ok: true, outDir })
      else resolve({ ok: false, error: (err || '7-Zip 解压失败').slice(0, 200) })
    })
  })
}

// 从剪贴板粘贴文件到当前目录。
// 剪贴板里的 Preferred DropEffect 决定语义：MOVE → 移动（剪切粘贴），否则复制。
// paste-helper.ps1 输出一行 JSON：{"paths":[...],"cut":bool}
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
      const raw = out.trim()
      if (!raw) return
      const parsed = JSON.parse(raw)
      // 兼容两种输出：老格式是纯数组，新格式是 {paths, cut}
      const list = Array.isArray(parsed) ? parsed : (parsed && parsed.paths)
      const cut = !Array.isArray(parsed) && !!(parsed && parsed.cut)
      if (!Array.isArray(list) || !list.length) return

      let done = 0
      for (const src of list) {
        if (!fs.existsSync(src)) continue
        const name = path.basename(src)
        const ext = path.extname(name)
        const base = path.basename(name, ext)
        let dest = path.join(currentPath, name)
        // 目标目录就是来源目录 → 什么都不做（剪贴板自己按 Ctrl+X 后再原处粘贴也是这个行为）
        if (path.dirname(src) === currentPath) {
          logError('paste 跳过（源与目标同目录）: ' + src)
          continue
        }
        if (cut) {
          // 移动：目标已存在时不覆盖，也不改名 —— 直接跳过并记日志，避免用户的文件被悄悄顶掉
          if (fs.existsSync(dest)) {
            logError('paste 移动跳过（目标已存在）: ' + dest)
            continue
          }
          try {
            fs.renameSync(src, dest)
            done++
          } catch (err) {
            // 跨盘符 / 跨设备 rename 会抛 EXDEV，退回「复制 + 删源」
            if (err.code === 'EXDEV') {
              try {
                fs.cpSync(src, dest, { recursive: true })
                fs.rmSync(src, { recursive: true, force: true })
                done++
              } catch (err2) { logError('paste move(EXDEV) failed: ' + src + ' -> ' + err2.message) }
            } else {
              logError('paste move failed: ' + src + ' -> ' + err.message)
            }
          }
        } else {
          // 复制：同名自动加「 - 副本N」
          let i = 2
          while (fs.existsSync(dest)) { dest = path.join(currentPath, `${base} - 副本${i}${ext}`); i++ }
          try {
            fs.cpSync(src, dest, { recursive: true })
            done++
          } catch (err) { logError('paste copy failed: ' + src + ' -> ' + err.message) }
        }
      }
      logError(`paste done: ${done} 项（${cut ? '移动' : '复制'}）`)
      if (done > 0 && popupWin && !popupWin.isDestroyed()) {
        popupWin.webContents.send('dir-changed')
      }
    } catch (err) { logError('paste parse: ' + err.message + ' raw=' + out.slice(0, 200)) }
  })
})

// 解压缩（渲染层也可直接调用）
ipcMain.handle('extract-archive', async (_event, filePath) => {
  const r = await extractArchiveTo(filePath)
  if (r.ok && popupWin && !popupWin.isDestroyed()) popupWin.webContents.send('dir-changed')
  return r
})


ipcMain.on('show-context-menu', (e, items) => {
  const template = []
  if (items.single) {
    template.push({ label: '打开', click: () => shell.openPath(items.paths[0]) })
    template.push({ label: '在资源管理器中显示', click: () => shell.showItemInFolder(items.paths[0]) })
    // 压缩包才给「解压」：放在「打开」附近，是这类文件最常用的动作。
    // 判定用后缀 + 确实是文件 —— 名字叫 xxx.zip 的文件夹不该出现这一项。
    let isArchive = false
    try {
      isArchive = ARCHIVE_EXTS.has(path.extname(items.paths[0]).toLowerCase()) && fs.statSync(items.paths[0]).isFile()
    } catch (err) { isArchive = false }
    if (isArchive) {
      template.push({
        label: '解压到当前文件夹',
        click: () => {
          extractArchiveTo(items.paths[0])
            .then(r => {
              if (r.ok) {
                if (popupWin && !popupWin.isDestroyed()) popupWin.webContents.send('dir-changed')
              } else if (popupWin && !popupWin.isDestroyed()) {
                dialog.showMessageBox(popupWin, { type: 'warning', message: '解压失败', detail: r.error || '未知错误', buttons: ['好'] })
              }
            })
        }
      })
    }
    template.push({ type: 'separator' })
    template.push({ label: '剪切', click: () => writeClipboard(items.paths, true) })
    template.push({ label: '复制', click: () => writeClipboard(items.paths, false) })
    template.push({ type: 'separator' })
    template.push({ label: '复制路径', click: () => clipboard.writeText(items.paths[0]) })
    template.push({ label: '重命名', click: () => { popupWin.webContents.send('do-rename', items.paths[0]) } })
    template.push({ label: '删除（回收站）', click: () => shell.trashItem(items.paths[0]) })
  } else {
    template.push({ label: `打开 ${items.paths.length} 项`, click: () => items.paths.forEach(p => shell.openPath(p)) })
    template.push({ type: 'separator' })
    template.push({ label: `剪切 ${items.paths.length} 项`, click: () => writeClipboard(items.paths, true) })
    template.push({ label: `复制 ${items.paths.length} 项`, click: () => writeClipboard(items.paths, false) })
    template.push({ type: 'separator' })
    template.push({ label: `删除 ${items.paths.length} 项（回收站）`, click: () => items.paths.forEach(p => shell.trashItem(p)) })
  }
  template.push({ type: 'separator' })
  template.push({ label: '粘贴到当前文件夹', click: () => popupWin.webContents.send('do-paste') })
  template.push({ label: '刷新', click: () => popupWin.webContents.send('dir-changed') })
  const menu = Menu.buildFromTemplate(template)
  shelfModalDepth++
  menu.popup({ window: popupWin, callback: () => { shelfModalDepth = Math.max(0, shelfModalDepth - 1) } })
})

// 设置菜单（下载栏顶栏 ⋯）
ipcMain.on('show-settings-menu', () => {
  const template = [
    { label: '更改文件夹…', click: async () => {
      const r = await dialog.showOpenDialog(popupWin, { properties: ['openDirectory'] })
      if (!r.canceled && r.filePaths[0]) {
        currentPath = r.filePaths[0]
        config.downloadPath = currentPath
        saveConfig()
        startWatcher()
        popupWin.webContents.send('dir-changed')
      }
    }},
    { label: '开机自启', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (mi) => app.setLoginItemSettings({ openAtLogin: mi.checked }) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]
  const menu = Menu.buildFromTemplate(template)
  shelfModalDepth++
  menu.popup({ window: popupWin, callback: () => { shelfModalDepth = Math.max(0, shelfModalDepth - 1) } })
})

ipcMain.on('hide-done', () => {
  logError('hide-done received')
  // 主进程发起的收起（失焦 / 快捷键 / 焦点轮询）：这里只是「退场动画播完了」的回执，
  // 接着把窗口真正收起来即可，不能再走 dismissPopup（那会多打一条误导人的日志）。
  if (pendingHide) {
    const finish = pendingHide
    pendingHide = null
    clearTimeout(hideFallbackTimer)
    finish()
    return
  }
  // 渲染层自己发起的收起（✕ 按钮直接回调，Esc 走淡出后回调）
  dismissPopup('close-button')
})

// ============================================================
//  IPC — 右栏（ClipShelf）
// ============================================================
ipcMain.handle('get-state', () => ({ shots: shots(), settings: clipSettings(), pinned, shelfOpen }))

ipcMain.handle('set-shelf-open', (event, value) => {
  if (event.sender !== popupWin?.webContents) return {}
  shelfOpen = Boolean(value)
  hidePreview()
  resizeShelf(shelfWidth)
  sendState()
  if (shelfOpen && fileShelf) fileShelf.refresh()
  return { open: shelfOpen, width: shelfWidth }
})

ipcMain.handle('resize-shelf', (event, width, finished) => {
  if (event.sender !== popupWin?.webContents || !Number.isFinite(width)) return {}
  // 手势期间临时放开 resizable，否则 Windows 会忽略 setSize
  if (!finished && popupWin && !popupWin.isDestroyed() && !popupWin.isResizable()) {
    try { popupWin.setResizable(true) } catch (e) { logError('shelf setResizable: ' + e.message) }
  }
  resizeShelf(width)
  if (finished) {
    config.shelfWidth = shelfWidth
    saveConfig()
    try { if (popupWin && !popupWin.isDestroyed()) popupWin.setResizable(false) } catch (e) {}
  }
  return { width: shelfWidth }
})

// 暂存架宽度变化 → 窗口总宽随之变化（右栏是「截图栏 388 + 暂存架」）
function resizeShelf(width) {
  if (!popupWin || popupWin.isDestroyed()) return
  const bounds = popupWin.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const available = area.width - (Math.round(popupWidth) + GAP + CLIP_W)
  const maxShelf = Math.max(SHELF_MIN, Math.min(SHELF_MAX, available))
  shelfWidth = Math.round(Math.min(Math.max(SHELF_MIN, width), maxShelf))
  config.shelfWidth = shelfWidth
  const w = Math.min(area.width, totalWidth())
  applySize(w, bounds.height)
  // 变宽后可能超出屏幕右缘，重新贴边
  const x = Math.max(area.x, Math.min(bounds.x, area.x + area.width - w))
  if (Math.round(x) !== bounds.x) {
    try { popupWin.setPosition(Math.round(x), bounds.y, false) } catch (e) {}
  }
  // 把权威宽度回传给渲染层，让它同步 --clip-shelf-w。
  // （拖拽手柄那条路径渲染层自己也会同步，但程序化调用——比如后面可能加的托盘项——
  //   只有主进程知道最终值，不回传就会出现「窗口变宽了、暂存架没变宽」的脱节。）
  // 只发一个数字，不发整份 state：拖拽时每秒几十次，带上 60 张缩略图会直接把主进程拖死。
  if (!popupWin.webContents.isLoading()) popupWin.webContents.send('shelf-width', shelfWidth)
  logError(`shelf resize: open=${shelfOpen} width=${shelfWidth} max=${maxShelf} win=${w}`)
}

ipcMain.on('hide-panel', () => dismissPopup('panel-close'))
ipcMain.on('set-pinned', (_event, value) => setPinned(value))
ipcMain.on('open-folder', () => { ensureShotFolder(); shell.openPath(shotFolder) })
ipcMain.on('reveal-file', (_event, file) => { if (trustedShot(file)) shell.showItemInFolder(file) })
ipcMain.on('preview-show', (_event, file) => showPreview(file))
ipcMain.on('preview-hide', () => hidePreview())

// 右栏图片卡片拖拽重排序：手势完全在渲染层做（纯 DOM insertBefore），
// 主进程只负责把最终顺序落盘 + 回推 state。
ipcMain.handle('shelf-reorder', (_event, order) => {
  if (!Array.isArray(order)) return clipSettings()
  // ⚠️ 必须白名单过滤：入参是渲染层从 DOM 的 dataset 里读回来再传过来的，
  //    不校验就会把任意路径写进 config.json 并长期生效。
  const known = []
  try {
    for (const name of fs.readdirSync(shotFolder)) {
      if (!SHOT_NAME.test(name)) continue
      const file = path.join(shotFolder, name)
      let date = 0
      try { date = fs.statSync(file).birthtimeMs } catch (e) { continue }
      known.push({ file, date })
    }
  } catch (e) { return clipSettings() }
  const allowed = new Set(known.map(k => k.file))

  const seen = new Set()
  const clean = []
  for (const file of order) {
    if (typeof file !== 'string' || !allowed.has(file) || seen.has(file)) continue
    seen.add(file)
    clean.push(file)
  }
  // 渲染层只认得当前渲染出来的那 60 张，所以要把它没见过的（更老的）文件补在后面。
  // 不补的话它们会因为「不在 clipOrder 里」而被规则当成新文件排到最前，
  // 把用户刚排好的顺序整个挤出 60 张可见范围。
  known.sort((a, b) => b.date - a.date)
  for (const item of known) if (!seen.has(item.file)) clean.push(item.file)

  clipOrder = clean
  config.clipOrder = clean
  saveConfig()
  logError(`shelf reorder: 本次可见 ${seen.size} 项，落盘 ${clean.length} 项`)
  sendState()
  return clipSettings()
})

// 拖动最近图片卡片到其他应用（注意：不是 dock 的 start-drag）
ipcMain.on('shot-drag', (event, file) => {
  if (!trustedShot(file)) return
  dragging = true
  hidePreview()
  const started = Date.now()
  logError('shot drag start: ' + path.basename(file))
  try {
    const icon = nativeImage.createFromPath(file).resize({ width: 96, height: 72, quality: 'good' })
    // ⚠️ startDrag 跑的是一个**模态的** OS 拖拽循环：这一行返回时拖拽就已经结束了，
    //    所以复位 dragging / 按需收起都写在返回之后。
    //    千万别指望渲染层的 dragend —— dragstart 里 preventDefault 之后浏览器就不再派发它，
    //    合并前挂的那条 drag-ended 通道其实从没触发过（error.log 里 0 次），
    //    结果是 dragging 一旦置位永不复位，表现出来就是「拖过一次卡片之后浮窗再也不自动收起」。
    event.sender.startDrag({ file, icon })
    logError(`shot drag end (${Date.now() - started}ms)`)
  } catch (error) {
    logError('shot drag failed: ' + error.message)
  }
  dragging = false
  if (!pinned && popupState === 'visible') hidePopup('shot-drag-complete')
})
ipcMain.on('drag-ended', () => {
  // 渲染层手势的兜底（pointerup / pointercancel / 窗口失焦）。
  // startDrag 是模态的话这里早就复位了，属空操作，不会重复收起。
  if (!dragging) return
  dragging = false
  if (!pinned) hidePopup('drag-ended')
})

ipcMain.handle('choose-folder', async () => {
  choosingFolder = true
  try {
    const answer = await dialog.showOpenDialog(popupWin, {
      title: '选择截图保存位置', defaultPath: shotFolder,
      properties: ['openDirectory', 'createDirectory']
    })
    if (!answer.canceled && answer.filePaths[0]) {
      shotFolder = answer.filePaths[0]
      config.clipFolder = shotFolder
      shotThumbCache.clear()
      ensureShotFolder()
      saveConfig()
      sendState()
    }
    return clipSettings()
  } finally { choosingFolder = false }
})

ipcMain.handle('save-retention', (_event, value) => {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0 || number > 3650) return clipSettings()
  retentionDays = number
  config.retentionDays = number
  saveConfig()
  cleanOldFiles()
  sendState()
  return clipSettings()
})

// 退出原因埋点：这是个常驻托盘应用，一旦「自己没了」必须能查出证据，
// 否则只能看到进程消失、error.log 里干干净净，完全无从下手。
// （appendFileSync 是同步的，所以在 process 'exit' 里也能落盘。）
// ⚠️ 只覆盖「优雅退出」的每条路径；如果这些全都静默、进程还是没了，
//    那结论就是被外部强杀（SIGKILL / taskkill /F），不是应用自己退的。
//    故意不给 SIGTERM/SIGINT 挂监听：挂上会让 Node 不再按默认行为终止，
//    反而把「杀不掉的进程」这种新问题引进来。
process.on('exit', (code) => logError(`process exit code=${code}`))

app.on('child-process-gone', (_e, details) => logError('child-process-gone: ' + JSON.stringify(details)))
app.on('render-process-gone', (_e, _wc, details) => logError('render-process-gone: ' + JSON.stringify(details)))

// ============================================================
//  生命周期
// ============================================================
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  logError('single instance lock 未获取到 → 退出（已有实例在跑？）')
  app.quit()
} else {
  app.on('second-instance', () => togglePopup('second-instance'))
  app.on('ready', () => {
    try {
      ensureShotFolder()
      cleanOldFiles()
      fileShelf = new FileShelf({
        root: path.join(app.getPath('userData'), 'Staging'),
        getWindow: () => popupWin,
        isActive: () => shelfOpen,
        modal: value => { shelfModalDepth = Math.max(0, shelfModalDepth + (value ? 1 : -1)) },
        scriptPath,
        logError
      })
      createPopup()
      createTray()
      if (isEnabled) startHook()
      startWatcher()
      appReady = true
      // 剪贴板图片轮询：复制了图片就自动存成一张「最近图片」
      setInterval(pollClipboard, POLL_MS)
      pollClipboard()
      cleanTimer = setInterval(cleanOldFiles, 60 * 60 * 1000)
      // 启动后自动弹出浮层，让用户立即看到效果（点别处 / Ctrl+Shift+V / Esc 收起）
      if (isEnabled) setTimeout(() => { try { showPopup() } catch (e) { logError('auto showPopup: ' + (e.stack || e.message)) } }, 350)
      logError('app ready, version=' + app.getVersion())
    } catch (e) {
      logError('ready handler: ' + (e.stack || e.message))
    }
  })
  app.on('before-quit', () => {
    logError('before-quit')
    app.isQuitting = true
    stopHook()
    if (watcher) { try { watcher.close() } catch (e) {} }
    if (cleanTimer) clearInterval(cleanTimer)
    if (fileShelf) fileShelf.close()
  })
  app.on('will-quit', () => logError('will-quit'))
  app.on('window-all-closed', () => {
    // 保持常驻（任务栏锚点），不退出
    logError('window-all-closed（忽略，保持常驻）')
  })
}
