# Draftly · 内容工作台

面向微信公众号的内容创作工作台：选题 → 大纲 → 正文 → 配图 → 预览 / 检测 → 推送草稿箱。支持桌面与移动端；长任务异步执行，前端轮询进度。

## 功能

- **创作流程**：工作台选题 → 多方案大纲 → 正文生成（含精炼关）/ 扩写 / 润色 → 标题摘要与配图 → 公众号样式预览 → 推送草稿箱 / 同步到博客
- **AI**：主模型 + 可选辅助模型（可跨厂商）；封面与章节配图（需配置图像模型）；面向微信「高信息量 / 反低质 AIGC」的写作约束与风险检测
- **内容质量**：生成后自动精炼（提信息密度、去套话）；风险检测覆盖 AI 套话、闲聊开篇、空洞注水、同质化骨架等信号
- **账号**：登录 / 注册；文章与设置按用户隔离；超管可管理用户
- **后台任务**：大纲 / 正文 / 配图等入队执行，浮标追踪进度；支持每用户并发与日配额
- **博客同步**：将正文转为 Markdown，经 GitHub Contents API 写入 vuepressblog，触发 Pages 自动部署

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

### 同步到 vuepressblog

正文生成后，可在文章页「发布」区点击 **同步到博客**，将 Markdown 写入 [vuepressblog](https://github.com/lp-Imagine/vuepressblog) 的 `website/sync/<section>/`，并触发 GitHub Actions 部署到 GitHub Pages。

每个账号可在自己的「设置 → 博客同步」里填 GitHub Token（`contents:write` + `actions:write`）、
目标仓库、分支与站点 URL。Token 仅保存在该用户下，其他人不可见。
未在设置中填写时会回退到 `.env` 中的全局默认值：

```bash
BLOG_GITHUB_TOKEN=ghp_xxx          # PAT：contents:write + actions:write
BLOG_GITHUB_REPO=lp-Imagine/vuepressblog
BLOG_GITHUB_BRANCH=master
BLOG_SITE_URL=https://lp-imagine.github.io/vuepressblog/
```

契约见博客仓库 `docs/SYNC.md`。同一篇文章再次同步会覆盖同路径文件（幂等）。

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

仓库可公开；下列内容**不要**提交到 Git，也不要发到 Issue / 聊天：

- `.env`、API Key、微信 AppSecret、数据库密码、超管密码
- 数据库备份 / 导出（含用户与文章）、服务器 SSH 密钥

本地：`cp .env.example .env` 后只改自己的 `.env`（已忽略）。  
生产：务必设置强 `POSTGRES_PASSWORD` / `SUPER_ADMIN_PASSWORD`；未设超管密码时生产环境会生成随机密码并打一次日志。仅 HTTP 时不要开 `COOKIE_SECURE`；上 HTTPS 后再设 `COOKIE_SECURE=1`。

## License

Private — 本地 / 内部使用。
