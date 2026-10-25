// 两人聊天 + 同步 DIY 空间 —— Node 服务端（依赖 ws，可选 mongodb）
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STATE_FILE = path.join(__dirname, 'rooms.json');
const MONGODB_URI = process.env.MONGODB_URI || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const USER_COLORS = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#b5179e', '#3a86ff', '#fb8500'];
const MAX_MSG = 200;
const MAX_ITEMS = 300;

// ---------- 静态文件服务 ----------
const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- 房间存储（内存为主，持久化到 MongoDB 或本地文件） ----------
const rooms = new Map(); // id -> { space: [], messages: [], clients: Set }
let db = null;          // { client, col } 或 null

function loadRooms() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    for (const [id, r] of Object.entries(data)) {
      rooms.set(id, {
        space: Array.isArray(r.space) ? r.space : [],
        messages: Array.isArray(r.messages) ? r.messages : [],
        clients: new Set(),
      });
    }
    console.log(`[rooms] 已从本地文件恢复 ${rooms.size} 个房间`);
  } catch {
    // 首次运行或文件损坏则忽略
  }
}

async function connectMongo() {
  if (!MONGODB_URI) return null;
  const { MongoClient } = require('mongodb');
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const col = client.db('xiaokongjian').collection('rooms');
  return { client, col };
}

async function loadRoomsFromMongo(col) {
  const docs = await col.find({}).toArray();
  let count = 0;
  for (const doc of docs) {
    rooms.set(doc._id, {
      space: Array.isArray(doc.space) ? doc.space : [],
      messages: Array.isArray(doc.messages) ? doc.messages : [],
      clients: new Set(),
    });
    count++;
  }
  return count;
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (db) return saveToMongo();
    saveToFile();
  }, 800);
}

function saveToFile() {
  const obj = {};
  for (const [id, r] of rooms) {
    obj[id] = { space: r.space.slice(0, MAX_ITEMS), messages: r.messages.slice(-MAX_MSG) };
  }
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(obj));
  } catch (e) {
    console.error('[rooms] 保存失败', e.message);
  }
}

async function saveToMongo() {
  const ops = [];
  for (const [id, r] of rooms) {
    ops.push(db.col.updateOne(
      { _id: id },
      { $set: { space: r.space.slice(0, MAX_ITEMS), messages: r.messages.slice(-MAX_MSG), updatedAt: new Date() } },
      { upsert: true }
    ));
  }
  try {
    await Promise.all(ops);
  } catch (e) {
    console.error('[db] 保存失败', e.message);
  }
}

function normalizeRoomId(raw) {
  if (!raw) return '';
  return String(raw).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32);
}

function pickColor(room) {
  const used = new Set([...room.clients].filter((c) => c.user).map((c) => c.user.color));
  return USER_COLORS.find((c) => !used.has(c)) || USER_COLORS[room.clients.size % USER_COLORS.length];
}

function defaultItemData(type) {
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

function seedRoom() {
  return {
    space: [
      {
        id: crypto.randomUUID(), type: 'note', x: 80, y: 80, w: 250, h: 170, z: 1,
        data: { text: '欢迎来到你们的小空间 🎉\n\n· 双击编辑内容\n· 拖动移动位置，右下角缩放\n· 右边可以聊天～', color: '#fff3b0' },
      },
      {
        id: crypto.randomUUID(), type: 'clock', x: 80, y: 290, w: 220, h: 120, z: 1,
        data: { bg: '#ffffff', color: '#111111' },
      },
    ],
    messages: [],
  };
}

function getRoom(id, create) {
  let room = rooms.get(id);
  if (!room && create) {
    room = { ...seedRoom(), clients: new Set() };
    rooms.set(id, room);
    scheduleSave();
  }
  if (room && !room.clients) room.clients = new Set();
  return room;
}

function clampNum(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function sanitizeItem(item) {
  if (!item || typeof item !== 'object') return null;
  const type = ['note', 'image', 'clock', 'todo', 'color', 'sticker'].includes(item.type) ? item.type : null;
  if (!type) return null;
  const clean = {
    id: String(item.id || crypto.randomUUID()).slice(0, 64),
    type,
    x: clampNum(item.x, -4000, 8000, 80),
    y: clampNum(item.y, -4000, 8000, 80),
    w: clampNum(item.w, 60, 1600, 220),
    h: clampNum(item.h, 40, 1200, 160),
    z: clampNum(item.z, 1, 999, 1),
    data: {},
  };
  const d = item.data && typeof item.data === 'object' ? item.data : {};
  if (type === 'note') clean.data = { text: String(d.text ?? '').slice(0, 5000), color: String(d.color || '#fff3b0').slice(0, 32) };
  else if (type === 'image') clean.data = { src: String(d.src ?? '').slice(0, 2_000_000), alt: String(d.alt ?? '照片').slice(0, 200) };
  else if (type === 'clock') clean.data = { bg: String(d.bg || '#ffffff').slice(0, 32), color: String(d.color || '#111111').slice(0, 32) };
  else if (type === 'todo') clean.data = {
    color: String(d.color || '#ffffff').slice(0, 32),
    items: (Array.isArray(d.items) ? d.items : []).slice(0, 100).map((t) => ({
      text: String(t.text ?? '').slice(0, 500),
      done: !!t.done,
    })),
  };
  else if (type === 'color') clean.data = { color: String(d.color || '#ff8fab').slice(0, 32) };
  else if (type === 'sticker') clean.data = { emoji: String(d.emoji || '🐱').slice(0, 16) };
  return clean;
}

function presenceList(room) {
  return [...room.clients].filter((c) => c.user && c.readyState === 1).map((c) => c.user);
}

function broadcast(room, obj) {
  const data = JSON.stringify(obj);
  for (const client of room.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.user = null;

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    handleMessage(ws, msg);
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => {});
});

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'join': return handleJoin(ws, msg);
    case 'chat': return handleChat(ws, msg);
    case 'typing': return handleTyping(ws, msg);
    case 'space': return handleSpace(ws, msg);
  }
}

function handleJoin(ws, msg) {
  let roomId = normalizeRoomId(msg.room);
  if (!roomId) roomId = crypto.randomBytes(3).toString('hex').toUpperCase();
  const room = getRoom(roomId, true);
  const name = String(msg.name || '').trim().slice(0, 20) || '访客';
  const user = { id: crypto.randomUUID(), name, color: pickColor(room) };
  ws.roomId = roomId;
  ws.user = user;
  room.clients.add(ws);

  ws.send(JSON.stringify({
    type: 'joined',
    room: roomId,
    self: user,
    users: presenceList(room),
    space: room.space,
    messages: room.messages.slice(-MAX_MSG),
  }));
  broadcast(room, { type: 'presence', users: presenceList(room) });
  console.log(`[join] ${user.name} -> 房间 ${roomId}（${room.clients.size} 人在线）`);
}

function handleChat(ws, msg) {
  if (!ws.user) return;
  const room = rooms.get(ws.roomId);
  if (!room) return;
  const text = String(msg.text || '').trim().slice(0, 1000);
  if (!text) return;
  const message = {
    id: crypto.randomUUID(),
    ts: Date.now(),
    user: { id: ws.user.id, name: ws.user.name, color: ws.user.color },
    text,
  };
  room.messages.push(message);
  if (room.messages.length > MAX_MSG) room.messages = room.messages.slice(-MAX_MSG);
  broadcast(room, { type: 'chat', message });
  scheduleSave();
}

function handleTyping(ws, msg) {
  if (!ws.user) return;
  const room = rooms.get(ws.roomId);
  if (!room) return;
  broadcast(room, { type: 'typing', user: { id: ws.user.id, name: ws.user.name }, on: !!msg.on });
}

function handleSpace(ws, msg) {
  if (!ws.user) return;
  const room = rooms.get(ws.roomId);
  if (!room) return;

  if (msg.op === 'add') {
    const item = sanitizeItem(msg.item);
    if (!item) return;
    if (room.space.length >= MAX_ITEMS) return;
    room.space.push(item);
    broadcast(room, { type: 'space', op: 'add', item });
    scheduleSave();
  } else if (msg.op === 'update') {
    const item = room.space.find((i) => i.id === msg.id);
    if (!item) return;
    const patch = msg.patch && typeof msg.patch === 'object' ? msg.patch : {};
    if (patch.x != null) item.x = clampNum(patch.x, -4000, 8000, item.x);
    if (patch.y != null) item.y = clampNum(patch.y, -4000, 8000, item.y);
    if (patch.w != null) item.w = clampNum(patch.w, 60, 1600, item.w);
    if (patch.h != null) item.h = clampNum(patch.h, 40, 1200, item.h);
    if (patch.z != null) item.z = clampNum(patch.z, 1, 999, item.z);
    if (patch.data && typeof patch.data === 'object') {
      const clean = sanitizeItem({ ...item, data: { ...item.data, ...patch.data } });
      if (clean) item.data = clean.data;
    }
    broadcast(room, { type: 'space', op: 'update', item });
    scheduleSave();
  } else if (msg.op === 'remove') {
    const before = room.space.length;
    room.space = room.space.filter((i) => i.id !== msg.id);
    if (room.space.length !== before) {
      broadcast(room, { type: 'space', op: 'remove', id: msg.id });
      scheduleSave();
    }
  }
}

function leaveRoom(ws) {
  if (!ws.roomId || !ws.user) return;
  const room = rooms.get(ws.roomId);
  if (room) {
    room.clients.delete(ws);
    broadcast(room, { type: 'presence', users: presenceList(room) });
    console.log(`[leave] ${ws.user.name} 离开房间 ${ws.roomId}（${room.clients.size} 人在线）`);
  }
  ws.roomId = null;
  ws.user = null;
}

// ---------- 启动 ----------
(async function start() {
  loadRooms();
  if (MONGODB_URI) {
    try {
      const mongo = await connectMongo();
      db = { client: mongo.client, col: mongo.col };
      const n = await loadRoomsFromMongo(db.col);
      console.log(`[db] 已连接 MongoDB，加载 ${n} 个房间`);
    } catch (e) {
      db = null;
      console.error('[db] MongoDB 连接失败，退回本地文件/内存模式:', e.message);
    }
  }
  server.listen(PORT, () => {
    console.log(`小空间已启动：http://localhost:${PORT}`);
  });
})();
