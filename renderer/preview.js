'use strict';
window.shelf.onPreview(data => {
  document.getElementById('image').src = data.src;
  document.getElementById('image').style.width = data.width + 'px';
  document.getElementById('image').style.height = data.height + 'px';
  document.getElementById('dimensions').textContent = `${data.originalWidth} × ${data.originalHeight}`;
  document.getElementById('date').textContent = new Date(data.date).toLocaleString('zh-CN');
});
