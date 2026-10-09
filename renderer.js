// ============================================================
//  DownloadsDock — 浮层渲染进程
// ============================================================
// `dock` is provided by preload through contextBridge.

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
let view = localStorage.getItem('dock-view') || 'list'

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
  const ic = f.icon ? `<img class="ic" src="${f.icon}" draggable="false" alt="">` : '<div class="ic"></div>'
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
}

function updateSel() {
  listEl.querySelectorAll('.item').forEach(el => {
    const p = decodeURIComponent(el.dataset.path)
    el.classList.toggle('selected', selectedPaths.has(p))
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
  const res = await dock.listFiles()
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
listEl.addEventListener('click', (e) => {
  const item = e.target.closest('.item')
  if (!item) return
  const p = decodeURIComponent(item.dataset.path)
  if (e.ctrlKey || e.metaKey) toggleSelect(p)
  else selectSingle(p)
})

listEl.addEventListener('dblclick', (e) => {
  const item = e.target.closest('.item')
  if (!item) return
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

// ---------- 顶栏 ----------
btnBack.addEventListener('click', () => { dock.navigateUp(); loadFiles() })
btnRefresh.addEventListener('click', () => loadFiles())
btnMenu.addEventListener('click', () => dock.showSettingsMenu())
btnClose.addEventListener('click', () => dock.hideDone())

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

// ---------- 动画 ----------
function playIn() {
  popupEl.classList.remove('visible')
  void popupEl.offsetWidth
  popupEl.classList.add('visible')
}
function playOut() {
  popupEl.classList.remove('visible')
}
popupEl.addEventListener('transitionend', (e) => {
  if (e.propertyName === 'opacity' && !popupEl.classList.contains('visible')) {
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
dock.onDirChanged(() => loadFiles())

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
