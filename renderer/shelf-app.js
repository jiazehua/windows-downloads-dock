'use strict';

(() => {
  const api = window.shelf.files;
  const pane = document.getElementById('file-shelf');
  const fileGrid = document.getElementById('file-grid');
  const zone = document.getElementById('shelf-drop-zone');
  const toggle = document.getElementById('shelf-toggle');
  const grip = document.getElementById('shelf-resize');
  const status = document.getElementById('shelf-status');
  const footer = status.parentElement;
  const nameDialog = document.getElementById('name-dialog');
  const nameInput = document.getElementById('entry-name');
  const nameError = document.getElementById('name-error');
  const selectionBox = document.getElementById('selection-box');
  let state = { files: [], root: '', relative: '', progress: null };
  let selected = new Set();
  let cutFiles = new Set();
  let anchor = -1;
  let focusedIndex = -1;
  let open = false;
  let shelfWidth = 380;
  let nameAction = null;
  let signature = '';
  let nativeDrag = false;
  let selecting = null;
  let selectionFrame;
  let statusTimer;
  let resizeGesture = null;
  let resizeFrame;

  const selectedPaths = () => state.files.filter(file => selected.has(file.file)).map(file => file.file);
  const fileRelative = file => file.slice(state.root.length + 1);
  const sizeLabel = bytes => bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 * 1024 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

  // 合并成双栏窗口后，暂存架的宽度不再是「把窗口撑大」而是「占据右栏的一部分」：
  // clip.css 里 .file-shelf 的宽度取自 --clip-shelf-w，这里把它同步给右栏容器。
  // 减 6 是因为右侧还有一根 6px 的拖宽手柄（#shelf-resize），主进程算窗口总宽时
  // 用的是「388 + shelfWidth」，那 6px 已经包含在 shelfWidth 里了。
  function applyShelfWidth() {
    const clip = document.getElementById('clipPane');
    if (clip) clip.style.setProperty('--clip-shelf-w', Math.max(0, shelfWidth - 6) + 'px');
  }

  function setStatus(message, error = false) {
    clearTimeout(statusTimer);
    footer.classList.toggle('error', error);
    status.textContent = message;
    if (error) statusTimer = setTimeout(updateSelection, 6500);
  }

  function updateSelection() {
    for (const tile of fileGrid.children) {
      const active = selected.has(tile.dataset.file);
      tile.classList.toggle('selected', active);
      tile.classList.toggle('cut', cutFiles.has(tile.dataset.file));
      tile.setAttribute('aria-selected', String(active));
    }
    if (!state.progress) {
      const files = state.files.filter(file => selected.has(file.file));
      setStatus(files.length ? `已选 ${files.length} 项${files.every(file => !file.directory) ? ' · ' + sizeLabel(files.reduce((sum, file) => sum + file.size, 0)) : ''}` : `${state.files.length} 项 · 手动清理`);
    }
  }

  function select(index, extend, toggleItem, preserve = false) {
    if (index < 0 || index >= state.files.length) return;
    const file = state.files[index].file;
    focusedIndex = index;
    if (extend && anchor >= 0) {
      if (!toggleItem) selected.clear();
      for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) selected.add(state.files[i].file);
    } else if (toggleItem) {
      if (selected.has(file)) selected.delete(file); else selected.add(file);
      anchor = index;
    } else if (!preserve || !selected.has(file)) {
      selected = new Set([file]);
      anchor = index;
    }
    updateSelection();
  }

  function imageElement(image, file) {
    if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.alt = '';
      img.draggable = false;
      return img;
    }
    const fallback = document.createElement('span');
    fallback.className = 'file-placeholder' + (file.directory ? ' folder' : '');
    fallback.textContent = file.directory ? '' : (file.name.split('.').pop().slice(0, 5).toUpperCase() || 'FILE');
    return fallback;
  }

  function tileFor(file, index) {
    const tile = document.createElement('div');
    tile.className = 'file-tile';
    tile.dataset.file = file.file;
    tile.setAttribute('role', 'option');
    tile.title = `${file.name}${file.directory ? ' · 文件夹' : ' · ' + sizeLabel(file.size)}`;
    tile.draggable = true;
    const image = document.createElement('div');
    image.className = 'file-image';
    image.append(imageElement(file.image, file));
    const label = document.createElement('span');
    label.className = 'file-name';
    label.textContent = file.name;
    tile.append(image, label);
    let wasSelected = false;
    tile.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      fileGrid.focus();
      wasSelected = selected.has(file.file);
      select(index, event.shiftKey, event.metaKey || event.ctrlKey, true);
    });
    tile.addEventListener('click', event => {
      if (nativeDrag || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (wasSelected && selected.size > 1) select(index, false, false);
    });
    tile.addEventListener('dblclick', () => {
      if (file.directory) navigate(fileRelative(file.file));
      else run(() => api.open([file.file]));
    });
    tile.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (!selected.has(file.file)) select(index, false, false);
      fileGrid.focus();
      run(() => api.context(selectedPaths()));
    });
    tile.addEventListener('dragstart', event => {
      event.preventDefault();
      if (!selected.has(file.file)) select(index, false, false);
      nativeDrag = true;
      window.shelf.previewHide();
      api.startDrag(selectedPaths());
    });
    tile.addEventListener('dragend', () => { nativeDrag = false; });
    return tile;
  }

  function render(next) {
    if (next.error) { setStatus(next.error, true); return; }
    const changedDirectory = next.relative !== state.relative;
    const scroll = changedDirectory ? 0 : fileGrid.scrollTop;
    state = next;
    const available = new Set(state.files.map(file => file.file));
    if (changedDirectory) { selected.clear(); anchor = -1; focusedIndex = -1; }
    else selected = new Set([...selected].filter(file => available.has(file)));
    const nextSignature = `${state.relative}\n${state.files.map(file => file.file + '\0' + file.modified + '\0' + file.size).join('\n')}`;
    if (signature !== nextSignature) {
      fileGrid.replaceChildren(...state.files.map(tileFor));
      signature = nextSignature;
      fileGrid.scrollTop = scroll;
    }
    document.getElementById('file-count').textContent = state.files.length;
    document.getElementById('shelf-empty').classList.toggle('hidden', state.files.length > 0);
    document.getElementById('shelf-up').disabled = !state.relative;
    document.getElementById('shelf-location').textContent = state.relative ? ' / ' + state.relative.replace(/\\/g, ' / ').replace(/\//g, ' / ').replace(/\s+/g, ' ') : '';
    updateSelection();
    renderProgress(state.progress);
  }

  function renderProgress(progress) {
    state.progress = progress;
    document.getElementById('cancel-copy').classList.toggle('hidden', !progress);
    if (progress) setStatus(`正在复制 ${progress.name || ''} · ${sizeLabel(progress.bytes || 0)}`);
    else updateSelection();
  }

  async function run(action, selectResult = false) {
    try {
      const result = await action();
      if (result?.error) { setStatus(result.error, true); return result; }
      if (selectResult && result?.files?.length) {
        render(await api.getState());
        selected = new Set(result.files);
        anchor = state.files.findIndex(file => selected.has(file.file));
        updateSelection();
      }
      return result;
    } catch (error) { setStatus(error.message, true); return { error: error.message }; }
  }

  async function navigate(relative) {
    const next = await run(() => api.navigate(relative));
    if (next && !next.error) render(next);
    fileGrid.focus();
  }

  function showNameDialog(action) {
    const file = state.files.find(file => selected.has(file.file));
    if (action === 'rename' && selected.size !== 1) return;
    nameAction = { action, file: file?.file };
    document.getElementById('name-title').textContent = action === 'rename' ? '重命名' : '新建文件夹';
    nameInput.value = action === 'rename' ? file.name : '未命名文件夹';
    nameError.textContent = '';
    nameDialog.classList.remove('hidden');
    window.__clipModalOpen = true;
    nameInput.focus();
    const dot = action === 'rename' && !file.directory ? file.name.lastIndexOf('.') : -1;
    nameInput.setSelectionRange(0, dot > 0 ? dot : nameInput.value.length);
  }

  function closeNameDialog() { nameDialog.classList.add('hidden'); nameAction = null; window.__clipModalOpen = false; fileGrid.focus(); }

  async function command(action) {
    if (action === 'select-all') { selected = new Set(state.files.map(file => file.file)); updateSelection(); return; }
    if (action === 'rename' || action === 'new-folder') { showNameDialog(action); return; }
    if (action === 'copy' || action === 'cut') {
      const result = await run(() => api.copy(selectedPaths(), action === 'cut'));
      if (result && !result.error) { cutFiles = new Set(result.cut ? result.copied : []); updateSelection(); }
      return;
    }
    if (action === 'paste') { const result = await run(() => api.paste(), true); if (!result?.error) { cutFiles.clear(); updateSelection(); } return; }
    if (action === 'open') {
      const paths = selectedPaths();
      const file = state.files.find(file => file.file === paths[0]);
      if (paths.length === 1 && file?.directory) await navigate(fileRelative(file.file));
      else await run(() => api.open(paths));
      return;
    }
    if (action === 'trash') { await run(() => api.trash(selectedPaths())); return; }
    if (action === 'reveal') await run(() => api.reveal(selectedPaths()));
  }

  window.shelf.onState(appState => {
    open = Boolean(appState.shelfOpen);
    shelfWidth = appState.settings.shelfWidth || shelfWidth;
    applyShelfWidth();
    pane.classList.toggle('hidden', !open);
    grip.classList.toggle('hidden', !open);
    toggle.classList.toggle('active', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.title = open ? '收起暂存架' : '展开暂存架';
  });
  window.shelf.getState().then(appState => {
    open = Boolean(appState.shelfOpen);
    shelfWidth = appState.settings.shelfWidth || shelfWidth;
    applyShelfWidth();
    pane.classList.toggle('hidden', !open);
    grip.classList.toggle('hidden', !open);
    if (open) run(() => api.getState()).then(next => { if (next && !next.error) render(next); });
  });
  api.onState(render);
  // 主进程是暂存架宽度的权威来源（拖拽 / 键盘 / 程序化调用都会走这里）
  window.shelf.onShelfWidth(width => { shelfWidth = width || shelfWidth; applyShelfWidth(); });
  api.onImage(({ file, image }) => {
    const index = state.files.findIndex(entry => entry.file === file);
    if (index < 0) return;
    state.files[index].image = image;
    fileGrid.children[index]?.querySelector('.file-image').replaceChildren(imageElement(image, state.files[index]));
  });
  api.onProgress(renderProgress);
  api.onCommand(command);
  api.onError(error => setStatus(error, true));
  toggle.addEventListener('click', () => window.shelf.setShelfOpen(!open));
  document.getElementById('shelf-folder').addEventListener('click', () => run(() => api.openFolder()));
  document.getElementById('shelf-more').addEventListener('click', () => run(() => api.context(selectedPaths())));
  document.getElementById('shelf-root').addEventListener('click', () => navigate(''));
  document.getElementById('shelf-up').addEventListener('click', () => navigate(state.relative.split(/[\\/]/).slice(0, -1).join('/')));
  document.getElementById('cancel-copy').addEventListener('click', () => api.cancel());
  document.getElementById('name-cancel').addEventListener('click', closeNameDialog);
  document.getElementById('name-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!nameAction) return;
    const result = await run(() => nameAction.action === 'rename' ? api.rename(nameAction.file, nameInput.value) : api.newFolder(nameInput.value), true);
    if (result?.error) nameError.textContent = result.error;
    else closeNameDialog();
  });
  fileGrid.addEventListener('contextmenu', event => {
    if (event.target.closest('.file-tile')) return;
    event.preventDefault();
    run(() => api.context(selectedPaths()));
  });

  zone.addEventListener('dragover', event => {
    event.preventDefault();
    if (event.dataTransfer.types.includes('Files')) { event.dataTransfer.dropEffect = 'copy'; zone.classList.add('drag-over'); }
  });
  zone.addEventListener('dragleave', event => { if (!zone.contains(event.relatedTarget)) zone.classList.remove('drag-over'); });
  zone.addEventListener('drop', event => {
    event.preventDefault();
    zone.classList.remove('drag-over');
    if (event.dataTransfer.files.length) run(() => api.importFiles(Array.from(event.dataTransfer.files)), true);
  });
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => event.preventDefault());

  function updateMarquee() {
    if (!selecting) return;
    const bounds = fileGrid.getBoundingClientRect();
    if (selecting.y < bounds.top + 20) fileGrid.scrollTop -= 7;
    else if (selecting.y > bounds.bottom - 20) fileGrid.scrollTop += 7;
    const currentX = Math.max(0, Math.min(bounds.width, selecting.x - bounds.left));
    const currentY = Math.max(0, Math.min(bounds.height, selecting.y - bounds.top)) + fileGrid.scrollTop;
    const left = Math.min(selecting.startX, currentX), top = Math.min(selecting.startY, currentY);
    const width = Math.abs(currentX - selecting.startX), height = Math.abs(currentY - selecting.startY);
    Object.assign(selectionBox.style, { left: left + 'px', top: top - fileGrid.scrollTop + 'px', width: width + 'px', height: height + 'px' });
    selected = new Set(selecting.base);
    for (const tile of fileGrid.children) {
      const rect = tile.getBoundingClientRect();
      const x = rect.left - bounds.left, y = rect.top - bounds.top + fileGrid.scrollTop;
      if (x < left + width && x + rect.width > left && y < top + height && y + rect.height > top) selected.add(tile.dataset.file);
    }
    updateSelection();
    selectionFrame = requestAnimationFrame(updateMarquee);
  }
  fileGrid.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('.file-tile')) return;
    fileGrid.focus();
    const bounds = fileGrid.getBoundingClientRect();
    if (event.clientX >= bounds.left + fileGrid.clientWidth) return;
    selecting = { x: event.clientX, y: event.clientY, startX: event.clientX - bounds.left, startY: event.clientY - bounds.top + fileGrid.scrollTop, base: event.metaKey || event.ctrlKey || event.shiftKey ? new Set(selected) : new Set() };
    selected = new Set(selecting.base);
    selectionBox.classList.remove('hidden');
    fileGrid.setPointerCapture(event.pointerId);
    updateMarquee();
    event.preventDefault();
  });
  fileGrid.addEventListener('pointermove', event => { if (selecting) { selecting.x = event.clientX; selecting.y = event.clientY; } });
  function endSelection() {
    selecting = null;
    cancelAnimationFrame(selectionFrame);
    selectionBox.classList.add('hidden');
  }
  fileGrid.addEventListener('pointerup', endSelection);
  fileGrid.addEventListener('pointercancel', endSelection);
  fileGrid.addEventListener('lostpointercapture', endSelection);
  document.addEventListener('pointerup', () => setTimeout(() => { nativeDrag = false; }, 150));
  window.addEventListener('focus', () => { nativeDrag = false; });

  document.addEventListener('keydown', event => {
    if (!open || event.target.closest('input, textarea')) {
      if (nameAction && event.key === 'Escape') { event.preventDefault(); closeNameDialog(); }
      return;
    }
    if (!pane.contains(document.activeElement)) return;
    const modified = event.metaKey || event.ctrlKey;
    const letter = event.key.toLowerCase();
    const actions = { a: 'select-all', c: 'copy', x: 'cut', v: 'paste' };
    if (modified && actions[letter]) { event.preventDefault(); command(actions[letter]); return; }
    if ((modified && event.key === 'Backspace') || event.key === 'Delete') { event.preventDefault(); command('trash'); return; }
    if (event.key === 'F2' || (event.key === 'Enter' && !modified)) { event.preventDefault(); command('rename'); return; }
    if (modified && event.key === 'ArrowDown') { event.preventDefault(); command('open'); return; }
    if (modified && event.key === 'ArrowUp') { event.preventDefault(); navigate(state.relative.split(/[\\/]/).slice(0, -1).join('/')); return; }
    const columns = getComputedStyle(fileGrid).gridTemplateColumns.split(' ').length;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
    if (step) {
      event.preventDefault();
      const index = Math.max(0, Math.min(state.files.length - 1, (focusedIndex < 0 ? 0 : focusedIndex) + step));
      select(index, event.shiftKey, false);
      if (!event.shiftKey) anchor = index;
      fileGrid.children[index]?.scrollIntoView({ block: 'nearest' });
    }
  }, true);

  grip.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    resizeGesture = { x: event.screenX, width: shelfWidth, target: shelfWidth };
    grip.setPointerCapture(event.pointerId);
    grip.classList.add('resizing');
  });
  grip.addEventListener('pointermove', event => {
    if (!resizeGesture) return;
    const width = resizeGesture.width + event.screenX - resizeGesture.x;
    resizeGesture.target = width;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(async () => {
      const result = await window.shelf.resizeShelf(width, false);
      if (result.width) { shelfWidth = result.width; applyShelfWidth(); }
    });
  });
  function finishResize() {
    if (!resizeGesture) return;
    const width = resizeGesture.target;
    resizeGesture = null;
    cancelAnimationFrame(resizeFrame);
    grip.classList.remove('resizing');
    window.shelf.resizeShelf(width, true).then(result => { if (result.width) { shelfWidth = result.width; applyShelfWidth(); } });
  }
  grip.addEventListener('pointerup', finishResize);
  grip.addEventListener('pointercancel', finishResize);
  grip.addEventListener('lostpointercapture', finishResize);
  grip.addEventListener('keydown', async event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const result = await window.shelf.resizeShelf(shelfWidth + (event.key === 'ArrowLeft' ? -20 : 20), true);
    if (result.width) { shelfWidth = result.width; applyShelfWidth(); }
  });
})();
