// 可视化编辑器：组件面板、画布、拖拽/缩放/编辑、实时同步
const STICKERS = ['🐱', '🐶', '🦊', '🐻', '🐼', '🐨', '🦄', '🐙', '🌸', '⭐', '💖', '🎈', '🍉', '🚀'];

let bus;
let canvas;
const itemEls = new Map(); // id -> element
const items = new Map();   // id -> item 数据
let selectedId = null;
let dragState = null;
let resizeState = null;
let lastLiveSent = 0;
let addCounter = 0;
let pendingImageId = null;
let pendingColorId = null;
let emojiPicker = null;

export function initEditor(b) {
  bus = b;
  canvas = document.querySelector('#canvas');

  document.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => addItem(btn.dataset.add));
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.target === canvas) select(null);
  });

  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !isTyping(e)) {
      bus.send({ type: 'space', op: 'remove', id: selectedId });
      select(null);
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (emojiPicker && !emojiPicker.contains(e.target)) closeEmojiPicker();
  });

  const fileInput = document.querySelector('#image-file');
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('请选择图片文件'); return; }
    if (file.size > 1.5 * 1024 * 1024) { alert('图片请小于 1.5MB'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (pendingImageId) {
        bus.send({ type: 'space', op: 'update', id: pendingImageId, patch: { data: { src: reader.result } } });
        pendingImageId = null;
      }
    };
    reader.readAsDataURL(file);
  });

  const colorInput = document.querySelector('#color-picker');
  colorInput.addEventListener('input', () => {
    if (pendingColorId) {
      bus.send({ type: 'space', op: 'update', id: pendingColorId, patch: { data: { color: colorInput.value } } });
    }
  });
  colorInput.addEventListener('change', () => { pendingColorId = null; });

  bus.on('joined', (m) => {
    clearCanvas();
    m.space.forEach((item) => renderItem(item));
  });

  bus.on('space', (m) => applySpaceOp(m));

  setInterval(tickClocks, 1000);
  tickClocks();
}

// ---------- 工具 ----------
function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function defaultData(type) {
  switch (type) {
    case 'note': return { text: '双击编辑便签内容 ✏️', color: '#fff3b0' };
    case 'image': return { src: '', alt: '照片' };
    case 'clock': return { bg: '#ffffff', color: '#111111' };
    case 'todo': return { items: [{ text: '双击编辑任务', done: false }], color: '#ffffff' };
    case 'color': return { color: '#ff8fab' };
    case 'sticker': return { emoji: '🐱' };
    default: return {};
  }
}

function defaultSize(type) {
  switch (type) {
    case 'note': return { w: 240, h: 160 };
    case 'image': return { w: 260, h: 200 };
    case 'clock': return { w: 220, h: 120 };
    case 'todo': return { w: 240, h: 200 };
    case 'color': return { w: 200, h: 160 };
    case 'sticker': return { w: 160, h: 160 };
    default: return { w: 220, h: 160 };
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

// ---------- 添加 / 渲染 ----------
function addItem(type) {
  const size = defaultSize(type);
  const item = {
    id: uid(), type,
    x: 80 + (addCounter % 5) * 36,
    y: 80 + (addCounter % 5) * 36,
    w: size.w, h: size.h, z: 1,
    data: defaultData(type),
  };
  addCounter++;
  renderItem(item); // 乐观渲染
  bus.send({ type: 'space', op: 'add', item });
}

function renderItem(item) {
  items.set(item.id, item);
  const old = itemEls.get(item.id);
  if (old) old.remove();

  const el = document.createElement('div');
  el.className = 'item';
  el.dataset.id = item.id;
  applyItemStyle(el, item);

  el.appendChild(buildContent(item));
  el.appendChild(buildHandles());
  wireInteractions(el, item);

  canvas.appendChild(el);
  itemEls.set(item.id, el);
  if (item.id === selectedId) el.classList.add('selected');
}

function applyItemStyle(el, item) {
  el.style.left = (item.x ?? 80) + 'px';
  el.style.top = (item.y ?? 80) + 'px';
  el.style.width = (item.w ?? 220) + 'px';
  el.style.height = (item.h ?? 160) + 'px';
  el.style.zIndex = item.z || 1;

  const t = item.type;
  if (t === 'note') el.style.background = item.data?.color || '#fff3b0';
  else if (t === 'clock') { el.style.background = item.data?.bg || '#ffffff'; el.style.color = item.data?.color || '#111111'; }
  else if (t === 'todo') el.style.background = item.data?.color || '#ffffff';
  else if (t === 'color') el.style.background = item.data?.color || '#ff8fab';
  else if (t === 'sticker') el.style.background = 'transparent';
  else if (t === 'image') el.style.background = '#22263a';
}

function buildHandles() {
  const frag = document.createDocumentFragment();
  const del = document.createElement('button');
  del.className = 'item-del';
  del.textContent = '×';
  del.title = '删除';
  const res = document.createElement('div');
  res.className = 'item-resize';
  res.title = '拖拽缩放';
  frag.append(del, res);
  return frag;
}

function buildContent(item) {
  const wrap = document.createElement('div');
  wrap.className = 'item-content';
  const t = item.type;

  if (t === 'note') {
    const p = document.createElement('div');
    p.className = 'note-text';
    p.textContent = item.data.text || '';
    wrap.appendChild(p);
  } else if (t === 'image') {
    if (item.data.src) {
      const img = document.createElement('img');
      img.className = 'image-img';
      img.src = item.data.src;
      img.alt = item.data.alt || '';
      wrap.appendChild(img);
    } else {
      const b = document.createElement('button');
      b.className = 'image-upload';
      b.textContent = '🖼️ 点击上传照片';
      wrap.appendChild(b);
    }
  } else if (t === 'clock') {
    const d = document.createElement('div');
    d.className = 'clock-display';
    wrap.appendChild(d);
  } else if (t === 'todo') {
    const list = document.createElement('div');
    list.className = 'todo-list';
    (item.data.items || []).forEach((task, i) => {
      const row = document.createElement('div');
      row.className = 'todo-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.idx = i;
      cb.checked = !!task.done;
      const span = document.createElement('span');
      span.className = 'todo-text' + (task.done ? ' done' : '');
      span.dataset.idx = i;
      span.textContent = task.text;
      const del = document.createElement('button');
      del.className = 'todo-del';
      del.dataset.idx = i;
      del.textContent = '×';
      del.title = '删除任务';
      row.append(cb, span, del);
      list.appendChild(row);
    });
    const add = document.createElement('button');
    add.className = 'todo-add';
    add.textContent = '+ 添加任务';
    list.appendChild(add);
    wrap.appendChild(list);
  } else if (t === 'color') {
    const d = document.createElement('div');
    d.className = 'color-block';
    wrap.appendChild(d);
  } else if (t === 'sticker') {
    const d = document.createElement('div');
    d.className = 'sticker-emoji';
    d.textContent = item.data.emoji || '🐱';
    wrap.appendChild(d);
  }
  return wrap;
}

// ---------- 交互 ----------
function wireInteractions(el, item) {
  el.addEventListener('mousedown', (e) => {
    if (e.target.closest('.item-del') || e.target.closest('.item-resize')) return;
    if (e.target.closest('input, button, textarea, select')) return;
    if (e.target.isContentEditable) return;
    select(item.id);
    startDrag(e, item);
  });

  el.querySelector('.item-del').addEventListener('click', (e) => {
    e.stopPropagation();
    bus.send({ type: 'space', op: 'remove', id: item.id });
    select(null);
  });

  el.querySelector('.item-resize').addEventListener('mousedown', (e) => {
    e.stopPropagation();
    select(item.id);
    startResize(e, item);
  });

  wireTypeEdit(el, item);
}

function startDrag(e, item) {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const origX = item.x;
  const origY = item.y;
  dragState = { item, startX, startY, origX, origY };

  const move = (ev) => {
    const nx = Math.round(origX + ev.clientX - startX);
    const ny = Math.round(origY + ev.clientY - startY);
    item.x = nx;
    item.y = ny;
    const el = itemEls.get(item.id);
    if (el) applyItemStyle(el, item);
    liveSend({ id: item.id, patch: { x: nx, y: ny } });
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    dragState = null;
    bus.send({ type: 'space', op: 'update', id: item.id, patch: { x: item.x, y: item.y } });
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function startResize(e, item) {
  e.preventDefault();
  const startX = e.clientX;
  const startY = e.clientY;
  const origW = item.w;
  const origH = item.h;
  resizeState = { item, startX, startY, origW, origH };

  const move = (ev) => {
    const nw = Math.max(60, Math.round(origW + ev.clientX - startX));
    const nh = Math.max(40, Math.round(origH + ev.clientY - startY));
    item.w = nw;
    item.h = nh;
    const el = itemEls.get(item.id);
    if (el) applyItemStyle(el, item);
    liveSend({ id: item.id, patch: { w: nw, h: nh } });
  };
  const up = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    resizeState = null;
    bus.send({ type: 'space', op: 'update', id: item.id, patch: { w: item.w, h: item.h } });
  };
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function liveSend(msg) {
  const now = Date.now();
  if (now - lastLiveSent > 120) {
    lastLiveSent = now;
    bus.send({ type: 'space', op: 'update', ...msg });
  }
}

function wireTypeEdit(el, item) {
  const t = item.type;

  if (t === 'note') {
    const textEl = el.querySelector('.note-text');
    textEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      textEl.contentEditable = 'true';
      textEl.focus();
      selectText(textEl);
    });
    textEl.addEventListener('blur', () => {
      textEl.contentEditable = 'false';
      const newText = textEl.textContent;
      if (newText !== item.data.text) {
        bus.send({ type: 'space', op: 'update', id: item.id, patch: { data: { text: newText } } });
      }
    });
    textEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') textEl.blur();
    });
  } else if (t === 'image') {
    const btn = el.querySelector('.image-upload');
    if (btn) {
      btn.addEventListener('click', () => {
        pendingImageId = item.id;
        document.querySelector('#image-file').click();
      });
    }
  } else if (t === 'color') {
    el.querySelector('.color-block').addEventListener('click', (e) => {
      e.stopPropagation();
      pendingColorId = item.id;
      const input = document.querySelector('#color-picker');
      input.value = item.data.color || '#ff8fab';
      input.click();
    });
  } else if (t === 'sticker') {
    el.querySelector('.sticker-emoji').addEventListener('click', (e) => {
      e.stopPropagation();
      openEmojiPicker(e.clientX, e.clientY, item);
    });
  } else if (t === 'todo') {
    wireTodo(el, item);
  }
}

function wireTodo(el, item) {
  const list = el.querySelector('.todo-list');

  list.addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) {
      const idx = Number(e.target.dataset.idx);
      const arr = [...item.data.items];
      if (arr[idx]) {
        arr[idx] = { ...arr[idx], done: e.target.checked };
        item.data.items = arr;
        bus.send({ type: 'space', op: 'update', id: item.id, patch: { data: { items: arr } } });
      }
    }
  });

  list.addEventListener('click', (e) => {
    if (e.target.classList.contains('todo-del')) {
      const idx = Number(e.target.dataset.idx);
      const arr = item.data.items.filter((_, i) => i !== idx);
      item.data.items = arr;
      bus.send({ type: 'space', op: 'update', id: item.id, patch: { data: { items: arr } } });
    } else if (e.target.classList.contains('todo-add')) {
      const arr = [...item.data.items, { text: '新任务', done: false }];
      item.data.items = arr;
      bus.send({ type: 'space', op: 'update', id: item.id, patch: { data: { items: arr } } });
    }
  });

  list.addEventListener('dblclick', (e) => {
    const textEl = e.target.closest('.todo-text');
    if (!textEl) return;
    e.stopPropagation();
    const idx = Number(textEl.dataset.idx);
    textEl.contentEditable = 'true';
    textEl.focus();
    selectText(textEl);
    const finish = () => {
      textEl.contentEditable = 'false';
      const arr = [...item.data.items];
      if (arr[idx]) {
        arr[idx] = { ...arr[idx], text: textEl.textContent };
        item.data.items = arr;
        bus.send({ type: 'space', op: 'update', id: item.id, patch: { data: { items: arr } } });
      }
      textEl.removeEventListener('blur', finish);
    };
    textEl.addEventListener('blur', finish);
    textEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') textEl.blur();
      if (ev.key === 'Enter') { ev.preventDefault(); textEl.blur(); }
    });
  });
}

function openEmojiPicker(x, y, item) {
  closeEmojiPicker();
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  STICKERS.forEach((emo) => {
    const b = document.createElement('button');
    b.textContent = emo;
    b.addEventListener('click', () => {
      bus.send({ type: 'space', op: 'update', id: item.id, patch: { data: { emoji: emo } } });
      closeEmojiPicker();
    });
    picker.appendChild(b);
  });
  document.body.appendChild(picker);
  picker.style.left = Math.min(x, window.innerWidth - 320) + 'px';
  picker.style.top = Math.min(y, window.innerHeight - 90) + 'px';
  emojiPicker = picker;
}

function closeEmojiPicker() {
  if (emojiPicker) {
    emojiPicker.remove();
    emojiPicker = null;
  }
}

function selectText(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function select(id) {
  selectedId = id;
  itemEls.forEach((el, key) => {
    el.classList.toggle('selected', key === id);
    if (key === id) el.style.zIndex = 9999;
    else el.style.zIndex = items.get(key)?.z || 1;
  });
}

// ---------- 同步 ----------
function applySpaceOp(m) {
  if (m.op === 'add') {
    const item = m.item;
    if (itemEls.has(item.id)) {
      itemEls.get(item.id).remove();
      itemEls.delete(item.id);
    }
    renderItem(item);
  } else if (m.op === 'update') {
    const item = m.item;
    const current = items.get(item.id);
    if (current) Object.assign(current, item);
    else items.set(item.id, item);

    if (dragState && dragState.item.id === item.id) {
      dragState.item.x = item.x;
      dragState.item.y = item.y;
      dragState.item.w = item.w;
      dragState.item.h = item.h;
      dragState.item.data = item.data;
      return;
    }

    const el = itemEls.get(item.id);
    if (el) {
      el.remove();
      itemEls.delete(item.id);
    }
    renderItem(item);
    if (selectedId === item.id) {
      const newEl = itemEls.get(item.id);
      if (newEl) newEl.classList.add('selected');
    }
  } else if (m.op === 'remove') {
    const el = itemEls.get(m.id);
    if (el) el.remove();
    itemEls.delete(m.id);
    items.delete(m.id);
    if (selectedId === m.id) selectedId = null;
  }
}

function clearCanvas() {
  itemEls.forEach((el) => el.remove());
  itemEls.clear();
  items.clear();
  selectedId = null;
  addCounter = 0;
}

function tickClocks() {
  document.querySelectorAll('.clock-display').forEach((d) => {
    d.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  });
}
