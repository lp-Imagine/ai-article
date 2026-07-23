# Draftly · 内容工作台

面向微信公众号的内容创作工作台：选题 → 大纲 → 正文 → 配图 → 预览 / 检测 → 推送草稿箱。支持桌面与移动端；长任务异步执行，前端轮询进度。

## 功能

- **创作流程**：工作台选题 → 多方案大纲 → 正文生成 / 扩写 / 润色 → 标题摘要与配图 → 公众号样式预览 → 推送草稿箱
- **AI**：主模型 + 可选辅助模型（可跨厂商）；封面与章节配图（需配置图像模型）；内容风险检测
- **账号**：登录 / 注册；文章与设置按用户隔离；超管可管理用户
- **后台任务**：大纲 / 正文 / 配图等入队执行，浮标追踪进度；支持每用户并发与日配额

## 技术栈

Next.js 16、React 19、Tailwind CSS 4、PostgreSQL、Prisma、Zod、Vitest

## 快速开始

需要 Node.js 20+ 与 PostgreSQL。

```bash
npm install
cp .env.example .env

# 终端 1：本机 Postgres（无 Docker 时）
npm run db:pg

# 或：docker compose up -d db

# 终端 2
npx prisma migrate deploy
npx prisma generate
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。默认超管见 `.env.example` 中的说明。

在 **设置** 页配置 AI / 图像 / 微信公众号，或写入环境变量（完整列表见 [`.env.example`](.env.example)）。

### 常用命令

```bash
npm run dev          # 开发
npm run db:pg        # 本机嵌入式 Postgres
npm run build        # 生产构建
npm run start        # 生产运行
npm run test         # 单元测试
```

## Docker 部署

```bash
docker compose up -d --build
```

Compose 会启动 PostgreSQL 与应用。请持久化 Postgres 数据卷，并参考 `.env.example` 配置 `DATABASE_URL`、任务配额、`COOKIE_SECURE` 等。

反代时建议拉长超时（如 `proxy_read_timeout 300s`），示例见 `docker/nginx-baota.conf.example`。有域名并启用 HTTPS 后，将 `COOKIE_SECURE=1`。

从旧版 SQLite 迁库可用：`npm run db:migrate:sqlite-to-pg`（需自行指定 `SQLITE_PATH` 与 `DATABASE_URL`）。

## 安全提示

- 勿将 API Key、微信 Secret 提交到 Git
- 生产环境请修改默认超管密码
- 仅 HTTP 访问时不要开启 `COOKIE_SECURE`

## License

Private — 本地 / 内部使用。
