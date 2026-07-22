# Draftly · 内容工作台

面向微信公众号的内容创作工作台：选题 → 大纲 → 正文 → 配图 → 预览 / 检测 → 推送草稿箱。支持桌面端与移动端；长任务可后台运行，并通过浮标追踪进度。

## 功能概览

### 创作工作流

1. **工作台** — 填写主题与写作参数，创建文章并生成多个大纲方案
2. **大纲选择** — 对比方案、选定方向，可重新生成
3. **正文生成** — AI 生成 HTML 正文，支持扩写、润色、格式刷新
4. **元信息与配图** — 备选标题、摘要、封面图、章节配图
5. **预览与推送** — 公众号样式预览，确认后推送到微信草稿箱

### AI 能力

- 多方案大纲（2～6 个）
- 正文生成 / 扩写 / 全文润色
- 备选标题、摘要
- 封面图与章节配图（需配置图像模型）
- 内容风险检测
- **主模型 + 辅助模型**：大纲 / 正文等用主文本模型；标题、摘要、封面提示词、章节配图文案等可用更轻量的辅助模型（可跨厂商：独立 Base URL / API Key）

### 微信集成

- 正文转为微信兼容 HTML（callout、代码块、摘要注入等）
- 草稿箱推送与推送历史
- 设置页可测试公众号 API 连通性（需将服务器出口 IP 加入公众号 IP 白名单）

### 后台任务与浮标

长耗时操作（生成大纲、正文、配图等）支持：

- 切换页面后任务继续运行
- 右下角浮标展示进行中任务，点击回到对应文章
- 多任务列表：分别跳转或取消
- 返回文章页自动恢复进度弹窗；网关超时等情况下会尝试与后台结果对齐
- 桌面端侧栏同步显示进行中任务

### 移动端

- 底部 Tab：工作台 / 历史 / 设置
- **文章编辑分步**：大纲 | 正文 | 发布（桌面端仍一屏铺开）
- 工作台表单压缩：次要字段收入「更多选项」，提交按钮保持可见
- 全屏公众号预览；进度弹窗适配安全区与底部导航

### 界面

- macOS 风格蓝调毛玻璃 UI
- 桌面端侧边栏 + 顶栏操作（预览 / 生成正文 / 推送）
- 历史记录支持删除；列表展示任务进行中状态

## 技术栈

- **框架**：Next.js 16（App Router）、React 19
- **样式**：Tailwind CSS 4、自定义 CSS 设计系统
- **数据库**：SQLite + Prisma
- **校验**：Zod
- **测试**：Vitest

## 快速开始

### 环境要求

- Node.js 20+
- npm / pnpm / yarn

### 安装与启动

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env

# 本地开发请使用本地库路径，例如：
# DATABASE_URL="file:./prisma/dev.db"

# 应用数据库迁移
npx prisma migrate dev

# 启动开发服务器
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

### 首次配置

进入 **设置** 页完成配置（也可写入环境变量；设置页保存后会同步到运行时）：

| 配置项 | 说明 |
|--------|------|
| AI API Key / Base URL / 文本模型 | 主模型：大纲、正文、润色、扩写等 |
| 辅助 AI Base URL / API Key / 模型 | 可选；标题、摘要、封面提示词等轻量任务 |
| 图像 API / 图像模型 | 封面与章节配图（可选） |
| 微信公众号 AppID / AppSecret | 草稿箱推送（可选） |

各模块提供「测试连接」按钮（含辅助模型连通性检测）。

### 常用命令

```bash
npm run dev      # 开发
npm run build    # 生产构建
npm run start    # 生产运行
npm run lint     # ESLint
npm run test     # Vitest 单元测试
npm run check    # lint + build
```

## 项目结构（简要）

```
src/
├── app/                    # 页面与 API Routes
│   ├── page.tsx            # 工作台
│   ├── history/            # 历史记录
│   ├── settings/           # 设置
│   └── articles/[id]/      # 文章编辑
├── components/             # UI（预览、进度、推送、浮标等）
├── hooks/                  # 后台任务等 Hooks
└── lib/                    # AI、微信、数据库、任务追踪、配置桥接
prisma/                     # 数据模型与迁移
docker/
├── entrypoint.sh           # 容器启动：迁移后拉起服务
└── bundle-prisma-cli.mjs   # 镜像内精简 Prisma CLI
```

## Docker 部署

SQLite 数据需挂载持久卷，否则容器重建后数据会丢失。

### 环境变量

至少设置：

| 变量 | 示例 | 说明 |
|------|------|------|
| `DATABASE_URL` | `file:/data/prod.db` | 与挂载路径一致 |
| `AI_API_KEY` | （你的 Key） | 主文本模型（也可部署后在设置页填写） |
| `AI_BASE_URL` | `https://api.openai.com/v1` | 可选 |
| `TEXT_MODEL_NAME` | `gpt-4o-mini` | 可选 |

可选增强：

| 变量 | 说明 |
|------|------|
| `AUXILIARY_AI_BASE_URL` / `AUXILIARY_AI_API_KEY` / `AUXILIARY_TEXT_MODEL_NAME` | 辅助文本模型（可跨厂商） |
| `IMAGE_*` | 图像生成 |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 微信草稿推送 |

完整列表见 [`.env.example`](.env.example)。微信、图像、辅助模型等也可部署后在 **设置** 页保存。

### 相关文件

| 文件 | 作用 |
|------|------|
| `Dockerfile` | Next.js standalone 多阶段镜像（含 Prisma） |
| `docker/entrypoint.sh` | 启动前执行 `prisma migrate deploy` |
| `docker/bundle-prisma-cli.mjs` | 构建阶段打包精简 Prisma CLI |
| `.env.example` | 环境变量模板 |

### 本地验证

```bash
docker build -t wechat-ai-writer .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="file:/data/prod.db" \
  -e AI_API_KEY="sk-..." \
  -v wechat-ai-data:/data \
  wechat-ai-writer
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。可用环境变量 `PORT` 覆盖默认端口 `3000`。

### 服务器一键更新（宝塔）

#### 拉取顺序

1. `git pull`（当前 `origin`，一般仍指向 GitHub）
2. GitHub zip → GitHub 代理镜像
3. **Gitee zip 兜底**（需事先把仓库同步到 Gitee）

#### Gitee 兜底（可选，推荐国内机）

仓库已同步：https://gitee.com/lp-imagine/ai-article.git  
（注意：GitHub 用户名是 `lp-Imagine`，Gitee 是 `lp-imagine`，大小写不同。）

每次本机 push GitHub 后，在 Gitee 点 **「从 GitHub 刷新」**，再跑服务器部署。服务器 **不必** 改 `origin`；GitHub 通就走 GitHub，不通再自动试 Gitee。

#### 日常更新

```bash
cd /www/ai-article && bash docker/deploy.sh
```

数据目录默认 `/www/data/ai-article`，不会丢。

**临时救急**（跳过拉代码，只用本地目录重建）：

```bash
cd /www/ai-article && SKIP_PULL=1 bash docker/deploy.sh
```
### 安全提示

- 已内置账号登录 / 注册；文章与设置按用户隔离。默认超管：`admin` / `admin123`（可用环境变量 `SUPER_ADMIN_USERNAME` / `SUPER_ADMIN_PASSWORD` 覆盖）。
- 用户管理页仅超级管理员可访问。
- API Key、微信 Secret 请勿提交到 Git；使用环境变量或设置页配置（写入当前用户）。

## 开发说明

- 微信正文样式：`src/lib/wechat-style.ts`
- 配置桥接（环境变量 ↔ 设置页 / 数据库）：`src/lib/config-bridge.ts`
- 后台任务状态存于 `sessionStorage`，跨页通过 `src/lib/article-task-tracker.ts` 与浮标组件同步
- API 响应解析与超时容错：`src/lib/api-client.ts`
- 修改 Prisma schema 后执行：`npx prisma migrate dev`

## License

Private — 本地 / 内部使用。
