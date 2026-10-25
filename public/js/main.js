// 入口：连接 WebSocket、加入房间、消息分发、在线用户展示
import { initChat } from './chat.js';
import { initEditor } from './editor.js';

const bus = {
  ws: null,
  self: null,
  roomId: null,
  users: [],
  handlers: new Map(),
  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  },
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  },
  emit(type, data) {
    (this.handlers.get(type) || []).forEach((fn) => fn(data));
  },
};

const $ = (sel) => document.querySelector(sel);

initChat(bus);
initEditor(bus);

// ---------- 加入房间 ----------
$('#random-room').addEventListener('click', () => {
  $('#join-room').value = genCode();
});
$('#join-btn').addEventListener('click', join);
for (const id of ['join-name', 'join-room']) {
  $('#' + id).addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
}
$('#copy-link').addEventListener('click', copyLink);

// 从链接读取房间号
const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) $('#join-room').value = urlRoom;
$('#join-name').value = localStorage.getItem('nickname') || '';

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function join() {
  const name = $('#join-name').value.trim() || '访客';
  let room = $('#join-room').value.trim();
  if (!room) {
    room = genCode();
    $('#join-room').value = room;
  }
  localStorage.setItem('nickname', name);
  connect(room, name);
}

function connect(room, name) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  bus.ws = ws;
  setConn('连接中…');
  ws.addEventListener('open', () => {
    setConn('已连接');
    ws.send(JSON.stringify({ type: 'join', room, name }));
  });
  ws.addEventListener('message', (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    handleMessage(m);
  });
  ws.addEventListener('close', () => setConn('连接断开，刷新重试'));
  ws.addEventListener('error', () => setConn('连接出错'));
}

function handleMessage(m) {
  switch (m.type) {
    case 'joined':
      bus.self = m.self;
      bus.roomId = m.room;
      bus.users = m.users;
      $('#join-screen').classList.add('hidden');
      $('#app').classList.remove('hidden');
      $('#room-code').textContent = m.room;
      history.replaceState(null, '', `${location.pathname}?room=${encodeURIComponent(m.room)}`);
      renderUsers();
      setConn('已连接');
      bus.emit('joined', m);
      break;
    case 'presence':
      bus.users = m.users;
      renderUsers();
      bus.emit('presence', m);
      break;
    case 'chat':
      bus.emit('chat', m.message);
      break;
    case 'typing':
      bus.emit('typing', m);
      break;
    case 'space':
      bus.emit('space', m);
      break;
  }
}

function renderUsers() {
  const el = $('#users');
  el.innerHTML = '';
  bus.users.forEach((u) => {
    const div = document.createElement('div');
    div.className = 'user';
    div.title = u.name + (u.id === bus.self?.id ? '（你）' : '');
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.style.background = u.color;
    avatar.textContent = u.name.slice(0, 1);
    const name = document.createElement('span');
    name.textContent = u.name;
    div.append(avatar, name);
    el.appendChild(div);
  });
}

function setConn(text) {
  $('#conn').textContent = text;
}

async function copyLink() {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(bus.roomId)}`;
  try {
    await navigator.clipboard.writeText(url);
    $('#copy-link').textContent = '已复制 ✓';
    setTimeout(() => { $('#copy-link').textContent = '复制邀请链接'; }, 1500);
  } catch {
    prompt('复制链接：', url);
  }
}
