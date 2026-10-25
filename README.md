# 小空间 · 两人聊天 + DIY

纯 HTML/CSS/JS + Node.js（ws）打造的两人实时聊天 + 同步可视化 DIY 编辑器。

## 功能

- 房间机制：同一房间号即可进入同一共享空间
- 实时聊天：消息、在线状态、正在输入提示
- 可视化编辑器：便签、照片、时钟、待办、色块、贴纸
- 组件拖拽移动、缩放、编辑、删除，操作实时同步给对方
- 房间状态自动保存到 `rooms.json`

## 本地运行

```bash
npm install
npm start
```

打开 http://localhost:3000

## 部署到 Render（免费）

1. 把本仓库推送到 GitHub
2. 登录 [render.com](https://render.com)，选择 New → Blueprint
3. 连接你的 GitHub 仓库，Render 会读取 `render.yaml` 自动部署
4. 部署完成后得到一个固定的 `https://xxx.onrender.com` 网址

> 注意：Render 免费版实例闲置 15 分钟后会休眠，首次打开需等待 30~60 秒；
> 免费版磁盘是临时的，重新部署或重启后聊天记录会清空（画布布置同样会重置）。

## 内网穿透（临时公网链接）

```bash
cloudflared tunnel --url http://localhost:3000
```

## 自检

```bash
node smoke-test.js
```
