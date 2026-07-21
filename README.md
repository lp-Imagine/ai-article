# 公众号 AI 发文助手

一个面向微信公众号的内容创作工作台：从选题、生成大纲、撰写正文，到配图、预览、风险检测，一键推送到微信草稿箱。支持桌面端与移动端，长任务可后台运行并通过浮标追踪进度。

## 功能概览

### 创作工作流

1. **工作台** — 填写主题与写作参数，一键创建文章并生成多个大纲方案
2. **大纲选择** — 对比方案、选定方向，可重新生成大纲
3. **正文生成** — AI 生成 HTML 正文，支持扩写、润色、格式刷新
4. **元信息与配图** — 备选标题、摘要、封面图、章节配图
5. **预览与推送** — 公众号样式预览，确认后推送到微信草稿箱

### AI 能力

- 多方案大纲生成（2～6 个）
- 正文生成 / 扩写 / 全文润色
- 备选标题、摘要生成
- 封面图与章节配图（需配置图像模型）
- 内容风险检测

### 微信集成

- 正文转换为微信兼容 HTML（callout、代码块、摘要注入等）
- 草稿箱推送与推送历史
- 设置页可测试公众号 API 连通性

### 后台任务与浮标

长耗时操作（生成大纲、正文、配图等）支持：

- **切换页面继续运行** — 任务在后台不中断
- **右下角浮标** — 在其他页面显示进行中的任务，点击回到对应文章
- **多任务** — 浮标可展开列表，分别跳转或取消
- **进度恢复** — 返回文章页自动恢复进度弹窗
- **PC 侧栏提示** — 桌面端左侧边栏同步显示进行中任务

### 移动端

- 底部 Tab 导航（工作台 / 历史 / 设置）
- 文章页底部操作栏：保存、预览、推送
- 全屏公众号预览
- 进度弹窗适配安全区与底部导航

### 界面

- macOS 风格蓝调毛玻璃 UI
- 桌面端侧边栏 + 顶栏操作组（预览 / 生成正文 / 推送）
- 历史列表与最近文章展示任务进行中状态

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

# 配置数据库（可复制 .env.example）
cp .env.example .env
# 本地开发请使用：
# DATABASE_URL="file:./dev.db"

# 应用数据库迁移
npx prisma migrate dev

# 启动开发服务器
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

### 首次配置

进入 **设置** 页完成配置（也可写入环境变量，设置页保存后会同步到运行时）：

| 配置项 | 说明 |
|--------|------|
| AI API Key / Base URL / 文本模型 | 大纲、正文等文本生成 |
| 图像 API / 图像模型 | 封面与章节配图（可选） |
| 微信公众号 AppID / AppSecret | 草稿箱推送（可选） |

各模块均提供「测试连接」按钮。

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
├── components/             # UI 组件（预览、进度、浮标等）
├── hooks/                  # 后台任务等 React Hooks
└── lib/                    # AI、微信、数据库、任务追踪
prisma/                     # 数据模型与迁移
```

## 部署到 Railway

项目已包含 Docker 与 Railway 配置，**无需改代码**即可从 GitHub 自动构建部署。SQLite 数据需挂载持久卷，否则重启后数据会丢失。

### 前置条件

- GitHub 仓库已推送本项目
- [Railway](https://railway.com) 账号（新用户约 $5 试用额度；长期稳定建议 **Hobby 约 $5/月**）

### 部署步骤

1. **新建项目** — 登录 Railway → **New Project** → **Deploy from GitHub repo**，选择本仓库。
2. **挂载 Volume（必做）** — 进入服务 → **Volumes** → **Add Volume**：
   - Mount Path：`/data`
   - 用于存放 SQLite 数据库文件
3. **环境变量** — 服务 → **Variables**，至少设置：

   | 变量 | 值 | 说明 |
   |------|-----|------|
   | `DATABASE_URL` | `file:/data/prod.db` | 与 Volume 路径一致 |
   | `AI_API_KEY` | （你的 Key） | 文本生成（也可部署后在设置页填写） |
   | `AI_BASE_URL` | 如 `https://api.openai.com/v1` | 可选，有默认值 |
   | `TEXT_MODEL_NAME` | 如 `gpt-4o-mini` | 可选 |

   完整列表见仓库根目录 [`.env.example`](.env.example)。微信、图像等配置可在部署后于 **设置** 页保存（写入数据库）。

4. **部署** — Railway 会读取 [`Dockerfile`](Dockerfile) 与 [`railway.toml`](railway.toml) 自动构建。容器启动时会执行 `prisma migrate deploy` 初始化/升级数据库。
5. **公网访问** — **Settings** → **Networking** → **Generate Domain**，获得 `*.up.railway.app` 地址。

### 相关文件

| 文件 | 作用 |
|------|------|
| `Dockerfile` | Next.js standalone 多阶段镜像，含 Prisma |
| `docker/entrypoint.sh` | 启动前自动跑数据库迁移 |
| `railway.toml` | Railway 构建与健康检查配置 |
| `.env.example` | 环境变量模板 |

### 本地 Docker 验证（可选）

```bash
docker build -t wechat-ai-writer .
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="file:/data/prod.db" \
  -v wechat-ai-data:/data \
  wechat-ai-writer
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

### 安全提示

- 部署到公网后**无内置登录**，任何人可访问；建议后续加访问控制，或仅在内网/VPN 使用。
- API Key、微信 Secret 请勿提交到 Git；使用 Railway Variables 或设置页配置。

## 开发说明

- 微信正文样式转换见 `src/lib/wechat-style.ts`
- 后台任务状态存于 `sessionStorage`，跨页通过 `src/lib/article-task-tracker.ts` 与 `BackgroundTaskFloat` 组件同步
- 修改 Prisma schema 后执行 `npx prisma migrate dev`

## License

Private — 本地/内部使用。
