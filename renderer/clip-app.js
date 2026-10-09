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

function cardFor(shot) {
  const card = document.createElement('article');
  card.className = 'card';
  card.draggable = true;
  card.title = '拖到任意支持文件拖放的应用';
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
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => window.shelf.previewShow(shot.file), 300);
  });
  card.addEventListener('mouseleave', stopPreview);
  card.addEventListener('dragstart', event => {
    event.preventDefault();
    stopPreview();
    window.shelf.startDrag(shot.file);
  });
  card.addEventListener('dragend', () => window.shelf.dragEnded());
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
  if (signature !== shotSignature || !grid.childElementCount) {
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
