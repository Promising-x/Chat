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

## 长期保存（MongoDB Atlas 免费云数据库）

Render 免费版磁盘是临时的，重启会清空。配置 `MONGODB_URI` 环境变量后，数据会保存到 MongoDB Atlas（免费 512MB），永久保留。

1. 注册 https://www.mongodb.com/cloud/atlas ，创建免费 M0 集群
2. 在 Database Access 创建数据库用户（记下用户名和密码）
3. 在 Network Access 添加 `0.0.0.0/0`（允许所有来源访问）
4. 点 Connect → Drivers，复制连接串，把 `<password>` 换成真实密码，形如：
   `mongodb+srv://user:pass@cluster0.xxx.mongodb.net/?retryWrites=true&w=majority`
5. 在 Render 服务的 Environment 里添加 `MONGODB_URI`，值为上面的连接串
6. 重新部署后生效

> 没有配置 `MONGODB_URI` 时自动退回本地 `rooms.json` 文件存储，两种模式兼容，本地开发不受影响。

## 内网穿透（临时公网链接）

```bash
cloudflared tunnel --url http://localhost:3000
```

## 自检

```bash
node smoke-test.js
```
