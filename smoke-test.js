// 双端冒烟测试：模拟两个用户加入同一房间，验证聊天与空间同步
const { WebSocket } = require('ws');

const URL = 'ws://127.0.0.1:3000';
const ROOM = 'SMOKE' + Math.floor(Math.random() * 10000);

function makeClient(name) {
  const ws = new WebSocket(URL);
  const inbox = [];
  ws.on('message', (d) => inbox.push(JSON.parse(d.toString())));
  const opened = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return { ws, inbox, name, opened };
}

function waitFor(client, pred, timeout = 4000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function check() {
      const found = client.inbox.find(pred);
      if (found) return resolve(found);
      if (Date.now() - start > timeout) return reject(new Error(`${client.name} 等待超时`));
      setTimeout(check, 20);
    })();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const a = makeClient('A');
  const b = makeClient('B');

  await Promise.all([a.opened, b.opened]);
  a.ws.send(JSON.stringify({ type: 'join', room: ROOM, name: 'Alice' }));
  const joinedA = await waitFor(a, (m) => m.type === 'joined');
  if (joinedA.room !== ROOM) throw new Error('A 加入的房间号不对');
  console.log('✓ A 加入房间', ROOM);

  b.ws.send(JSON.stringify({ type: 'join', room: ROOM, name: 'Bob' }));
  const joinedB = await waitFor(b, (m) => m.type === 'joined');
  if (joinedB.users.length !== 2) throw new Error('B 加入时在线人数应为 2');
  console.log('✓ B 加入同一房间，在线人数', joinedB.users.length);

  // 聊天同步
  a.ws.send(JSON.stringify({ type: 'chat', text: '你好 Bob！' }));
  const chatB = await waitFor(b, (m) => m.type === 'chat');
  if (chatB.message.text !== '你好 Bob！' || chatB.message.user.name !== 'Alice') throw new Error('聊天消息内容不对');
  console.log('✓ B 收到 A 的聊天消息:', chatB.message.text);

  // 空间组件同步
  const item = { id: 'test-item-1', type: 'sticker', x: 100, y: 100, w: 160, h: 160, z: 1, data: { emoji: '🐱' } };
  a.ws.send(JSON.stringify({ type: 'space', op: 'add', item }));
  const addB = await waitFor(b, (m) => m.type === 'space' && m.op === 'add');
  if (addB.item.id !== 'test-item-1') throw new Error('B 收到的组件 id 不对');
  console.log('✓ B 收到 A 添加的组件:', addB.item.type, addB.item.id);

  // 组件更新同步
  a.ws.send(JSON.stringify({ type: 'space', op: 'update', id: 'test-item-1', patch: { x: 500, y: 300 } }));
  const updB = await waitFor(b, (m) => m.type === 'space' && m.op === 'update');
  if (updB.item.x !== 500 || updB.item.y !== 300) throw new Error('B 收到的组件位置不对');
  console.log('✓ B 收到组件位置更新:', updB.item.x, updB.item.y);

  // 组件删除同步
  a.ws.send(JSON.stringify({ type: 'space', op: 'remove', id: 'test-item-1' }));
  const delB = await waitFor(b, (m) => m.type === 'space' && m.op === 'remove');
  if (delB.id !== 'test-item-1') throw new Error('B 收到的删除 id 不对');
  console.log('✓ B 收到组件删除');

  // 离开后在线人数更新
  a.ws.close();
  const presB = await waitFor(b, (m) => m.type === 'presence' && m.users.length === 1);
  console.log('✓ A 离开后 B 看到在线人数:', presB.users.length);

  b.ws.close();
  await sleep(200);
  console.log('\n✅ 冒烟测试全部通过');
  process.exit(0);
})().catch((e) => {
  console.error('\n❌ 冒烟测试失败:', e.message);
  process.exit(1);
});
