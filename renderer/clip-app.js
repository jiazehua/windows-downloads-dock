'use strict';

// ⚠️ 包在 IIFE 里：与 renderer.js / shelf-app.js 同处一个 document，
//    顶层 function 会挂到 window 上互相覆盖（历史上两者的 render 就撞过车）。
(() => {

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const settingsPane = document.getElementById('settings-pane');
const count = document.getElementById('count');
const pinButton = document.getElementById('pin');
const retention = document.getElementById('retention');
const folderPath = document.getElementById('folder-path');
let previewTimer = null;
let currentState = { shots: [], settings: {}, pinned: false };
let settingsOpen = false;
let shotSignature = '';

function stopPreview() {
  clearTimeout(previewTimer);
  previewTimer = null;
  window.shelf.previewHide();
}

function dateLabel(epoch) {
  const date = new Date(epoch);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ---------- 卡片拖拽：栏内拖 = 重排序；拖出窗口 = 拖到其他应用 ----------
// 两种意图共用同一个「按住左键拖动」，靠指针还在不在浮窗里来分流：
//   · 留在窗口内 → 直接 insertBefore 实时换位，松手把顺序落盘；
//   · 越过窗口边界 → 把 DOM 还原成拖动前的样子，改走 Electron 原生 startDrag。
// ⚠️ 为什么不用 HTML5 的 dragstart/dragend：
//    原来那套是 dragstart 里 preventDefault() 再手动 startDrag，而 preventDefault 之后
//    浏览器**不会再派发 dragend**，挂在上面的 dragEnded() 从来没触发过（error.log 里 0 次），
//    主进程的 dragging 标志一旦置位就永不复位 —— 表现为「拖过一次卡片，浮窗再也不自动收起」。
//    换成指针事件后这条链路是自己握着的，顺带把这个老坑填了。
const OUT_MARGIN = 12        // 越过窗口多少像素才算「要拖出去」，容忍手抖
let gesture = null           // { el, file, pointerId, startX, startY, origin[], reordering }

function outsideWindow(x, y) {
  return x < -OUT_MARGIN || y < -OUT_MARGIN
    || x > window.innerWidth + OUT_MARGIN || y > window.innerHeight + OUT_MARGIN
}

function clearGestureClasses() {
  if (gesture) gesture.el.classList.remove('dragging')
  grid.classList.remove('reordering')
}

// 把插入位置换算成「在其余卡片里的下标」，再把被拖的卡片插进去。
// 从前往后扫：哪张卡片的中心在指针「后面」，就插到它前面。
function placeDragged(x, y) {
  const el = gesture.el
  const others = []
  for (const child of grid.children) if (child !== el) others.push(child)
  let index = others.length
  for (let i = 0; i < others.length; i++) {
    const rect = others[i].getBoundingClientRect()
    if (y < rect.top) { index = i; break }                                   // 整行都在指针下方
    if (y <= rect.bottom && x < rect.left + rect.width / 2) { index = i; break }  // 同行且在卡片左半边
  }
  const target = others[index] || null
  // 位置没变就别动 DOM：重复 insertBefore 会打断过渡动画，白掉帧
  if (target !== el.nextElementSibling) grid.insertBefore(el, target)
}

function autoScroll(y) {
  const rect = grid.getBoundingClientRect()
  if (y < rect.top + 26) grid.scrollTop -= 10
  else if (y > rect.bottom - 26) grid.scrollTop += 10
}

function handOffToNativeDrag(file) {
  const origin = gesture.origin
  clearGestureClasses()
  gesture = null
  // 这次手势不是要排序，把 DOM 还原，别让它停在半路
  for (const el of origin) grid.appendChild(el)
  stopPreview()
  window.shelf.startDrag(file)
  // 兜底：主进程那边靠 startDrag 的模态返回复位 dragging，万一没如期返回，
  // 指针抬起 / 窗口失焦也能补一刀（主进程侧做了幂等，不会重复收起）。
  const once = () => {
    window.removeEventListener('pointerup', once)
    window.removeEventListener('blur', once)
    window.shelf.dragEnded()
  }
  window.addEventListener('pointerup', once)
  window.addEventListener('blur', once)
}

grid.addEventListener('pointerdown', event => {
  if (event.button !== 0 || gesture) return
  if (event.target.closest('.reveal')) return       // 「在资源管理器中显示」按钮不参与拖拽
  const card = event.target.closest('.card')
  if (!card || !card.dataset.file) return
  gesture = {
    el: card,
    file: card.dataset.file,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    origin: Array.from(grid.children),
    reordering: false
  }
  card.setPointerCapture(event.pointerId)
})

grid.addEventListener('pointermove', event => {
  if (!gesture || event.pointerId !== gesture.pointerId) return
  if (!gesture.reordering
    && Math.abs(event.clientX - gesture.startX) < 5
    && Math.abs(event.clientY - gesture.startY) < 5) return   // 还没动够，先当点击看
  if (outsideWindow(event.clientX, event.clientY)) {
    handOffToNativeDrag(gesture.file)
    return
  }
  if (!gesture.reordering) {
    gesture.reordering = true
    gesture.el.classList.add('dragging')
    grid.classList.add('reordering')
    stopPreview()
  }
  placeDragged(event.clientX, event.clientY)
  autoScroll(event.clientY)
})

grid.addEventListener('pointerup', event => {
  if (!gesture || event.pointerId !== gesture.pointerId) return
  const reordering = gesture.reordering
  clearGestureClasses()
  gesture = null
  if (!reordering) return                          // 只是一次点击
  const order = Array.from(grid.children).map(node => node.dataset.file).filter(Boolean)
  if (order.length) window.shelf.reorder(order)
})

grid.addEventListener('pointercancel', () => {
  if (!gesture) return
  const origin = gesture.origin
  clearGestureClasses()
  gesture = null
  for (const el of origin) grid.appendChild(el)    // 手势被系统打断 → 还原，不落盘
})

function cardFor(shot) {
  const card = document.createElement('article');
  card.className = 'card';
  // 不用 HTML5 拖拽（见上面 pointerdown 的注释），手势全在指针事件里自己做
  card.draggable = false;
  card.dataset.file = shot.file;
  card.title = '按住拖动可调整顺序；拖出浮窗可拖到其他应用';
  const image = document.createElement('img');
  image.className = 'card-preview';
  image.src = shot.image;
  image.alt = dateLabel(shot.date) + ' 的截图';
  const footer = document.createElement('div');
  footer.className = 'card-footer';
  const time = document.createElement('span');
  time.className = 'card-time';
  time.textContent = dateLabel(shot.date);
  const reveal = document.createElement('button');
  reveal.className = 'reveal';
  reveal.type = 'button';
  reveal.title = '在资源管理器中显示';
  reveal.setAttribute('aria-label', '在资源管理器中显示');
  reveal.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v10H3V7Z"/><path d="M12 14h7m-3-3 3 3-3 3"/></svg>';
  reveal.addEventListener('click', event => {
    event.stopPropagation();
    stopPreview();
    window.shelf.revealFile(shot.file);
  });
  reveal.addEventListener('dragstart', event => event.preventDefault());
  footer.append(time, reveal);
  card.append(image, footer);
  card.addEventListener('mouseenter', () => {
    if (gesture) return;                 // 拖拽换位中不弹预览，否则预览窗跟着乱跳
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => window.shelf.previewShow(shot.file), 300);
  });
  card.addEventListener('mouseleave', stopPreview);
  return card;
}

function render(state) {
  currentState = state;
  const scroll = grid.scrollTop;
  count.textContent = String(state.shots.length);
  pinButton.classList.toggle('active', state.pinned);
  pinButton.title = state.pinned ? '已固定，点击取消固定' : '固定窗口';
  pinButton.setAttribute('aria-label', pinButton.title);
  retention.value = state.settings.retentionDays;
  folderPath.textContent = state.settings.folder;
  const signature = state.shots.map(shot => shot.file).join('\n');
  // 拖拽换位途中不要重建 DOM：replaceChildren 会把拖到一半的卡片、指针捕获
  // 和刚刚 insertBefore 出来的顺序一起丢掉。等手势结束、reorder 落盘推回来的
  // 那份 state 自然会带上新顺序。
  if (!gesture && (signature !== shotSignature || !grid.childElementCount)) {
    grid.replaceChildren(...state.shots.map(cardFor));
    shotSignature = signature;
  }
  grid.scrollTop = scroll;
  empty.classList.toggle('hidden', settingsOpen || state.shots.length > 0);
  grid.classList.toggle('hidden', settingsOpen || state.shots.length === 0);
}

function showSettings(show) {
  settingsOpen = show;
  // 供 DownloadsDock 渲染进程判断：偏好设置打开时不响应 Esc 收起整个浮层
  window.__clipModalOpen = show;
  stopPreview();
  settingsPane.classList.toggle('hidden', !show);
  empty.classList.toggle('hidden', show || currentState.shots.length > 0);
  grid.classList.toggle('hidden', show || currentState.shots.length === 0);
  if (show) {
    retention.value = currentState.settings.retentionDays;
    folderPath.textContent = currentState.settings.folder;
  }
}

window.shelf.onState(render);
window.shelf.onOpenSettings(() => showSettings(true));
window.shelf.getState().then(render);
grid.addEventListener('scroll', stopPreview, { passive: true });
document.getElementById('pin').addEventListener('click', () => window.shelf.setPinned(!currentState.pinned));
document.getElementById('folder').addEventListener('click', () => window.shelf.openFolder());
document.getElementById('settings').addEventListener('click', () => showSettings(!settingsOpen));
document.getElementById('close').addEventListener('click', () => window.shelf.hide());
document.getElementById('back').addEventListener('click', () => showSettings(false));
document.getElementById('choose-folder').addEventListener('click', async () => {
  const next = await window.shelf.chooseFolder();
  currentState.settings = next;
  folderPath.textContent = next.folder;
});
document.getElementById('save').addEventListener('click', async () => {
  const days = Number(retention.value);
  if (!Number.isInteger(days) || days < 0 || days > 3650) {
    retention.focus();
    return;
  }
  currentState.settings = await window.shelf.saveRetention(days);
  showSettings(false);
});
document.addEventListener('keydown', event => {
  if (event.defaultPrevented) return;
  if (event.key === 'Escape') {
    if (settingsOpen) showSettings(false);
    else window.shelf.hide();
  }
});

})();
