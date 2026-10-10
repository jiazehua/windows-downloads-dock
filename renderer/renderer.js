// ============================================================
//  DownloadsDock — 浮层渲染进程（左栏）
// ============================================================
// `dock` is exposed as a non-configurable global by contextBridge.  Declaring
// `const dock` again throws in recent Electron versions and stops this entire
// script before any buttons or file loading handlers are registered.
//
// ⚠️ 整个文件包在 IIFE 里：本文件和 clip-app.js / shelf-app.js 跑在同一个
//    document 里，classic script 的顶层 function 会挂到 window 上互相覆盖。
//    最初 renderer.js 和 clip-app.js 都定义了顶层 function render()，
//    后加载的 clip-app 把下载栏的 render 顶掉，导致下载栏每次刷新都在调用
//    clip 的 render(undefined)（日志表现为「Cannot read properties of
//    undefined (reading 'shots')」）。收进 IIFE 后两边彻底隔离。
(function () {

const popupEl = document.getElementById('popup')
const listEl = document.getElementById('list')
const searchEl = document.getElementById('search')
const pathEl = document.getElementById('path')
const statusEl = document.getElementById('status')
const btnBack = document.getElementById('btnBack')
const btnView = document.getElementById('btnView')
const btnRefresh = document.getElementById('btnRefresh')
const btnMenu = document.getElementById('btnMenu')
const btnClose = document.getElementById('btnClose')

let currentDir = ''
let allFiles = []
let selectedPaths = new Set()
// 已按 Ctrl+X 剪切、正挂在系统剪贴板上的路径集合。
// 声明放在这里而不是按键处理旁边：updateSel() 每次渲染都会读它，
// 用 let 声明在函数之后会出现 TDZ（初始化前调用就报错）。
let cutPaths = new Set()
let view = localStorage.getItem('dock-view') || 'list'
// ⚠️ 键名带 -2 是故意的：老键 dock-icon-size 里存着旧默认值 56，
//    直接改默认值会被 localStorage 里的 56 盖掉，用户根本看不到变化。
//    换键名 = 让新默认值 44 真正生效一次；用户之后 Ctrl+滚轮调过的值照常记住。
let iconSize = parseInt(localStorage.getItem('dock-icon-size-2'), 10) || 44
let loadSequence = 0
let thumbObserver = null
const thumbnailCache = new Map()
const PREVIEW_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.heic', '.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v', '.pdf'])

// ---------- 工具 ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function fmtSize(b) {
  if (b == null) return ''
  if (b < 1024) return b + ' B'
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'
  return (b / 1073741824).toFixed(2) + ' GB'
}
function fmtTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ---------- 渲染 ----------
function itemHTML(f) {
  const full = currentDir + '\\' + f.name
  const sel = selectedPaths.has(full) ? ' selected' : ''
  const cls = 'item' + (f.isDir ? ' dir' : '') + sel
  const sz = f.isDir ? '' : fmtSize(f.size)
  const mt = fmtTime(f.mtime)
  const marker = f.isDir ? '📁' : '·'
  const kind = !f.isDir && PREVIEW_EXTENSIONS.has(f.ext) ? ' preview' : ' file-icon'
  const ic = `<div class="ic thumb${kind}" data-thumb="${encodeURIComponent(full)}"><span>${marker}</span></div>`
  return `<div class="${cls}" data-path="${encodeURIComponent(full)}" data-dir="${f.isDir ? '1' : ''}" draggable="true">
    ${ic}
    <div class="nm">${escapeHtml(f.name)}</div>
    <div class="sz">${sz}</div>
    <div class="mt">${mt}</div>
  </div>`
}

function applyFilter() {
  const q = searchEl.value.trim().toLowerCase()
  return q ? allFiles.filter(f => f.name.toLowerCase().includes(q)) : allFiles
}

function render() {
  const files = applyFilter()
  if (!files.length) {
    listEl.innerHTML = `<div class="empty">${allFiles.length ? '无匹配结果' : '（空文件夹）'}</div>`
  } else {
    listEl.innerHTML = files.map(itemHTML).join('')
  }
  updateStatus(files.length)
  observeThumbnails()
}

function observeThumbnails() {
  if (thumbObserver) thumbObserver.disconnect()
  thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      thumbObserver.unobserve(entry.target)
      loadThumbnail(entry.target)
    }
  }, { root: listEl, rootMargin: '140px' })
  listEl.querySelectorAll('[data-thumb]').forEach(el => thumbObserver.observe(el))
}

async function loadThumbnail(el) {
  const p = decodeURIComponent(el.dataset.thumb)
  const size = view === 'grid' ? 128 : 48
  const key = `${p}|${size}`
  let data = thumbnailCache.get(key)
  if (data === undefined) {
    data = await dock.getThumbnail(p, size)
    thumbnailCache.set(key, data || '')
    if (thumbnailCache.size > 300) thumbnailCache.delete(thumbnailCache.keys().next().value)
  }
  if (data && el.isConnected && decodeURIComponent(el.dataset.thumb) === p) {
    el.style.backgroundImage = `url("${data}")`
    el.classList.add('loaded')
  }
}

function updateSel() {
  listEl.querySelectorAll('.item').forEach(el => {
    const p = decodeURIComponent(el.dataset.path)
    el.classList.toggle('selected', selectedPaths.has(p))
    // 重建 DOM 后 .cut 会丢，这里一起补上（cutPaths 是跨渲染保留的）
    el.classList.toggle('cut', cutPaths.has(p))
  })
}

function updateStatus(shown) {
  if (!allFiles.length) { statusEl.textContent = '（空文件夹）'; return }
  const total = allFiles.reduce((s, f) => s + (f.size || 0), 0)
  if (shown === allFiles.length) {
    statusEl.textContent = `共 ${allFiles.length} 项 · 总大小 ${fmtSize(total)}`
  } else {
    statusEl.textContent = `显示 ${shown} / 共 ${allFiles.length} 项`
  }
}

async function loadFiles() {
  const sequence = ++loadSequence
  let res
  try {
    res = await dock.listFiles()
  } catch (err) {
    allFiles = []
    listEl.innerHTML = `<div class="empty">读取文件夹失败：${escapeHtml(err.message || err)}</div>`
    statusEl.textContent = '读取失败'
    return
  }
  if (sequence !== loadSequence) return
  if (res && res.error) {
    allFiles = []
    currentDir = res.dir || currentDir
  } else if (res) {
    currentDir = res.dir
    allFiles = res.items || []
  }
  pathEl.textContent = currentDir
  pathEl.title = currentDir
  selectedPaths.clear()
  render()
}

// ---------- 选择 ----------
function selectSingle(p) { selectedPaths = new Set([p]); updateSel() }
function toggleSelect(p) {
  if (selectedPaths.has(p)) selectedPaths.delete(p); else selectedPaths.add(p)
  updateSel()
}

// ---------- 事件委托 ----------
let lastSelEndTime = 0

// 绑定到左栏（不再绑 document）：右栏 ClipShelf 的点击不应该清掉下载区的选中
popupEl.addEventListener('click', (e) => {
  const item = e.target.closest('.item')
  if (item) {
    const p = decodeURIComponent(item.dataset.path)
    if (e.ctrlKey || e.metaKey) toggleSelect(p)
    else selectSingle(p)
  } else if (Date.now() - lastSelEndTime > 150) {
    // 点击空白处：取消所有选中（框选刚结束的 150ms 内忽略，避免误清）
    if (selectedPaths.size) { selectedPaths.clear(); updateSel() }
  }
})

listEl.addEventListener('dblclick', (e) => {
  const item = e.target.closest('.item')
  if (!item) {
    // 双击空白处 → 返回上一级。
    // 触发条件是「空白」：不是文件项、不是「空文件夹」提示，也不是刚框选完。
    // 框选（拖拽选择）松手后也会落在空白处，若不排除，用户每框选一次就被踢出目录，
    // 所以沿用单击空白那套 150ms 时间窗（见 mousedown 里的 lastSelEndTime）。
    if (e.target.closest('.empty')) return
    if (Date.now() - lastSelEndTime <= 150) return
    dock.navigateUp()
    loadFiles()
    return
  }
  const p = decodeURIComponent(item.dataset.path)
  if (item.dataset.dir === '1') {
    dock.enterDir(p)
    loadFiles()
  } else {
    dock.openPath(p)
  }
})

listEl.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  const item = e.target.closest('.item')
  let paths = [...selectedPaths]
  if (item) {
    const p = decodeURIComponent(item.dataset.path)
    if (!paths.includes(p)) paths = [p]
  }
  dock.showContextMenu({ single: paths.length === 1, paths })
})

listEl.addEventListener('dragstart', (e) => {
  const item = e.target.closest('.item')
  if (!item) { e.preventDefault(); return }
  e.preventDefault()
  e.stopPropagation()
  const p = decodeURIComponent(item.dataset.path)
  let paths = [...selectedPaths]
  if (!paths.includes(p)) paths = [p]
  if (paths.length) dock.startDrag(paths)
})

// ---------- 圈选（框选）：在空白处按住左键拖动 ----------
let selBoxEl = null
let selStart = null
let didBoxSelect = false

listEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  if (e.target.closest('.item')) return   // 从文件上按下 → 走点击/拖拽
  if (e.target.closest('.empty')) return
  // 点空白：立即取消选中（不依赖 click 事件，最可靠；框选开始会重新选择，shift/ctrl 保留增量）
  if (Date.now() - lastSelEndTime > 150 && !e.shiftKey && !e.ctrlKey && !e.metaKey && selectedPaths.size) {
    selectedPaths.clear()
    updateSel()
  }
  const rect = listEl.getBoundingClientRect()
  selStart = { cx: e.clientX, cy: e.clientY }
  e.preventDefault()
})

document.addEventListener('mousemove', (e) => {
  if (!selStart) return
  const rect = listEl.getBoundingClientRect()
  const x1 = Math.min(selStart.cx, e.clientX) - rect.left
  const y1 = Math.min(selStart.cy, e.clientY) - rect.top
  const x2 = Math.max(selStart.cx, e.clientX) - rect.left
  const y2 = Math.max(selStart.cy, e.clientY) - rect.top
  if (!selBoxEl) {
    selBoxEl = document.createElement('div')
    selBoxEl.className = 'sel-box'
    didBoxSelect = true
    listEl.appendChild(selBoxEl)
  }
  selBoxEl.style.left = x1 + 'px'
  selBoxEl.style.top = y1 + 'px'
  selBoxEl.style.width = (x2 - x1) + 'px'
  selBoxEl.style.height = (y2 - y1) + 'px'
  // 相交检测（带滚动偏移补偿）
  const s = {
    left: x1 + listEl.scrollLeft, top: y1 + listEl.scrollTop,
    right: x2 + listEl.scrollLeft, bottom: y2 + listEl.scrollTop
  }
  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) selectedPaths.clear()
  listEl.querySelectorAll('.item').forEach(el => {
    const r = el.getBoundingClientRect()
    const ir = {
      left: r.left - rect.left + listEl.scrollLeft,
      top: r.top - rect.top + listEl.scrollTop,
      right: r.right - rect.left + listEl.scrollLeft,
      bottom: r.bottom - rect.top + listEl.scrollTop
    }
    const hit = ir.left < s.right && ir.right > s.left && ir.top < s.bottom && ir.bottom > s.top
    const p = decodeURIComponent(el.dataset.path)
    if (hit) selectedPaths.add(p)
    el.classList.toggle('selected', selectedPaths.has(p))
  })
})

document.addEventListener('mouseup', () => {
  if (!selStart) return
  selStart = null
  // 只有确实发生过框选才抑制随后的空白 click（避免误清框选结果）
  if (didBoxSelect) { lastSelEndTime = Date.now(); didBoxSelect = false }
  if (selBoxEl) { selBoxEl.remove(); selBoxEl = null }
})

// ---------- Ctrl+滚轮 放大/缩小图标 ----------
function applyIconSize() {
  document.documentElement.style.setProperty('--icon-size', iconSize + 'px')
  localStorage.setItem('dock-icon-size-2', iconSize)
}
applyIconSize()

listEl.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return
  e.preventDefault()
  const delta = e.deltaY < 0 ? 1 : -1
  const next = Math.min(96, Math.max(20, iconSize + delta * 4))
  if (next !== iconSize) { iconSize = next; applyIconSize() }
}, { passive: false })

// ---------- 拖拽调整浮层宽度（右侧手柄，主进程轮询屏幕坐标驱动） ----------
const resizeHandleEl = document.getElementById('resizeHandle')
let resizing = false
if (resizeHandleEl) {
  resizeHandleEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    resizing = true
    document.body.classList.add('resizing')
    dock.beginResize()
  })
}
document.addEventListener('mouseup', () => {
  if (resizing) {
    resizing = false
    document.body.classList.remove('resizing')
    dock.endResize()
  }
})

// ---------- 顶栏 ----------
btnBack.addEventListener('click', () => { dock.navigateUp(); loadFiles() })
btnRefresh.addEventListener('click', () => loadFiles())
btnMenu.addEventListener('click', () => dock.showSettingsMenu())
// pointerdown is more reliable than click for a frameless transparent window.
btnClose.addEventListener('pointerdown', (e) => {
  e.preventDefault()
  e.stopPropagation()
  dock.hideDone()
})

btnView.addEventListener('click', () => {
  view = view === 'list' ? 'grid' : 'list'
  localStorage.setItem('dock-view', view)
  applyView()
  render()
})

function applyView() {
  listEl.classList.toggle('view-grid', view === 'grid')
  listEl.classList.toggle('view-list', view === 'list')
  btnView.textContent = view === 'list' ? '网格' : '列表'
}

// ---------- 搜索 ----------
searchEl.addEventListener('input', () => render())
document.addEventListener('keydown', (e) => {
  // 右栏 ClipShelf 在捕获阶段已经 preventDefault 的按键，不再重复处理
  if (e.defaultPrevented) return
  if (e.key === 'Escape') {
    // 右栏有模态（偏好设置 / 重命名对话框）打开时，交给它自己先关
    if (window.__clipModalOpen) return
    e.preventDefault()
    playOut()
    return
  }
  // 输入框内（如重命名/搜索）不拦截，走默认文本复制粘贴
  const tag = e.target && e.target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  // 焦点在右栏（ClipShelf / 暂存架）时不抢 Ctrl+C / Ctrl+V
  const clipPaneEl = document.getElementById('clipPane')
  if (clipPaneEl && clipPaneEl.contains(document.activeElement)) return
  if (!(e.ctrlKey || e.metaKey)) return
  const k = e.key.toLowerCase()
  if (k === 'c' && selectedPaths.size) {
    e.preventDefault()
    dock.copyFiles([...selectedPaths])
    clearCut()   // 改成复制了，之前的剪切标记要撤掉
  } else if (k === 'x' && selectedPaths.size) {
    // 剪切：写进系统剪贴板（带 MOVE 标记），粘到哪都是「移动」。
    // 剪完立刻把图标变半透明，让用户看得出「这些已经被剪走了」——
    // 资源管理器也是这个反馈，没有的话用户会怀疑到底按没按上。
    e.preventDefault()
    dock.cutFiles([...selectedPaths])
    markCut([...selectedPaths])
  } else if (k === 'v') {
    e.preventDefault()
    dock.pasteFiles()
  }
})

// 被剪切的路径：给对应图标打 .cut 类（半透明），粘贴或重新复制后清除。
function markCut (paths) {
  cutPaths = new Set(paths)
  updateCutVisual()
}
function clearCut () {
  if (!cutPaths.size) return
  cutPaths = new Set()
  updateCutVisual()
}
function updateCutVisual () {
  for (const el of listEl.querySelectorAll('.item')) {
    const p = decodeURIComponent(el.dataset.path)
    el.classList.toggle('cut', cutPaths.has(p))
  }
}

// ---------- 动画 ----------
// 合并成双栏窗口后，入场动画挂在 #app 上，左右两栏一起淡入；
// #popup 上的 .visible 保留为状态标记（主进程会读取它判断浮层是否已显示）。
const appEl = document.getElementById('app')
function playIn() {
  appEl.classList.remove('visible')
  void appEl.offsetWidth
  appEl.classList.add('visible')
  popupEl.classList.add('visible')
}
function playOut() {
  appEl.classList.remove('visible')
  popupEl.classList.remove('visible')
}
appEl.addEventListener('transitionend', (e) => {
  if (e.propertyName === 'opacity' && !appEl.classList.contains('visible')) {
    dock.hideDone()
  }
})

// ---------- 重命名（内联编辑） ----------
dock.onDoRename((p) => {
  const item = listEl.querySelector(`.item[data-path="${encodeURIComponent(p)}"]`)
  if (!item) return
  const nm = item.querySelector('.nm')
  const old = nm.textContent
  const input = document.createElement('input')
  input.value = old
  input.className = 'rename-input'
  nm.replaceWith(input)
  input.focus()
  input.select()
  let done = false
  const finish = async (commit) => {
    if (done) return
    done = true
    if (commit && input.value && input.value !== old) {
      await dock.rename(p, input.value)
    }
    loadFiles()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true) }
    else if (e.key === 'Escape') { finish(false) }
  })
  input.addEventListener('blur', () => finish(true))
})

// ---------- IPC 事件 ----------
dock.onShow(() => { playIn(); loadFiles() })
dock.onHide(() => playOut())
dock.onDirChanged(() => { clearCut(); loadFiles() })
// 右键菜单里的「粘贴到当前文件夹」——和 Ctrl+V 同一条路径
if (dock.onDoPaste) dock.onDoPaste(() => dock.pasteFiles())

// 兜底：窗口从隐藏变可见（主进程 show 但 IPC 可能早于监听注册而丢失）时补动画+刷新
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    playIn()
    loadFiles()
  }
})

// ---------- 初始化 ----------
applyView()
dock.getCurrentDir().then(d => { currentDir = d; loadFiles() })

})()
