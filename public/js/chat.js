// 聊天模块：消息渲染、发送、正在输入提示
let bus;
let inputTimer = null;
let receiveTimer = null;
let typingSent = false;
let typingUser = null;

export function initChat(b) {
  bus = b;
  const form = document.querySelector('#chat-form');
  const input = document.querySelector('#chat-input');
  const messages = document.querySelector('#chat-messages');
  const typing = document.querySelector('#typing');

  bus.on('joined', (m) => {
    messages.innerHTML = '';
    m.messages.forEach((msg) => addMessage(msg));
    scrollBottom();
  });

  bus.on('chat', (msg) => {
    addMessage(msg);
    scrollBottom();
    if (typingUser && typingUser.id === msg.user.id) {
      typingUser = null;
      typing.textContent = '';
    }
  });

  bus.on('typing', (m) => {
    if (m.on && (!bus.self || m.user.id !== bus.self.id)) {
      typingUser = m.user;
      typing.textContent = `${m.user.name} 正在输入…`;
      clearTimeout(receiveTimer);
      receiveTimer = setTimeout(() => {
        typingUser = null;
        typing.textContent = '';
      }, 2500);
    } else if (!m.on && typingUser && typingUser.id === m.user.id) {
      typingUser = null;
      typing.textContent = '';
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    bus.send({ type: 'chat', text });
    input.value = '';
    sendTyping(false);
  });

  let lastTypeSent = 0;
  input.addEventListener('input', () => {
    if (input.value.trim()) {
      const now = Date.now();
      if (now - lastTypeSent > 800) {
        lastTypeSent = now;
        sendTyping(true);
      }
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => sendTyping(false), 1600);
    } else {
      sendTyping(false);
    }
  });
}

function sendTyping(on) {
  if (typingSent === on) return;
  typingSent = on;
  bus.send({ type: 'typing', on });
}

function addMessage(msg) {
  const el = document.querySelector('#chat-messages');
  const mine = bus.self && msg.user.id === bus.self.id;
  const div = document.createElement('div');
  div.className = 'msg' + (mine ? ' mine' : '');

  const meta = document.createElement('div');
  meta.className = 'meta';
  const name = document.createElement('span');
  name.textContent = mine ? '我' : msg.user.name;
  if (!mine) name.style.color = msg.user.color;
  const time = document.createElement('span');
  time.textContent = new Date(msg.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  meta.append(name, time);

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = msg.text;

  div.append(meta, text);
  el.appendChild(div);
}

function scrollBottom() {
  const el = document.querySelector('#chat-messages');
  el.scrollTop = el.scrollHeight;
}
