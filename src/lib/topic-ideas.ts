import type { BlogSection } from "@/lib/blog-sync-constants";
import { BLOG_SECTIONS } from "@/lib/blog-sync-constants";
import { db } from "@/lib/db";
import { generateHotTopics } from "@/lib/ai";
import { getAccountPersona } from "@/lib/ai/prompts/common";

export type TopicIdeaSource = "history" | "template" | "hot" | "mixed";

export type TopicIdeasMode = "all" | "history" | "hot";

export type TopicIdeasCategory =
  | "all"
  | "web"
  | "ai"
  | "backend"
  | "career"
  | "business"
  | "life"
  | "writing";

export type TopicIdea = {
  topic: string;
  reason: string;
  source: TopicIdeaSource;
  score: number;
  tags?: string[];
};

export type TopicIdeasRequest = {
  userId: string;
  count?: number;
  section?: BlogSection | null;
  /** @deprecated 用 mode；false 时等价于 history */
  includeHot?: boolean;
  mode?: TopicIdeasMode;
  cursor?: number;
  /** 换一批：强制重新生成 LLM 热点，跳过热点缓存 */
  refresh?: boolean;
  /** 选题分类（综合/前端/AI/后端/职场/商业/生活/写作），null 或 all 表示综合 */
  category?: TopicIdeasCategory | null;
};

type Candidate = {
  topic: string;
  reason: string;
  source: TopicIdeaSource;
  tags: string[];
  baseScore: number;
};

type TopicIdeasResult = {
  ideas: TopicIdea[];
  fromCache: boolean;
  degradedHot: boolean;
  mode: TopicIdeasMode;
  emptyReason: string | null;
};

const SECTION_TAGS: Record<BlogSection, string[]> = {
  web: ["前端", "React", "Vue", "TypeScript", "组件", "框架"],
  ui: ["UI", "CSS", "设计系统", "交互", "可访问性", "动效"],
  engineering: ["工程化", "Git", "npm", "工具链", "CI", "构建"],
  backend: ["后端", "Node.js", "数据库", "MySQL", "服务端", "API"],
  tech: ["文档", "GitHub", "备忘", "收藏", "Markdown", "效率"],
  computer: ["浏览器", "Chrome", "扩展", "渲染", "调试", "性能"],
  agent: ["Agent", "Cursor", "提示词", "工作流", "MCP", "工具链"],
  misc: ["方法论", "案例", "复盘", "清单", "对比", "生活", "职场", "商业", "理财", "教育"],
};

const TEMPLATE_TOPICS: Array<{ topic: string; tags: string[] }> = [
  // 技术/工程
  { topic: "我把一个低效流程自动化后，效率提升了多少", tags: ["自动化", "效率", "复盘"] },
  { topic: "这 5 个常见误区，正在拖慢你的交付速度", tags: ["误区", "效率", "交付"] },
  { topic: "从 0 到 1 做一个可复用组件，我踩过的坑", tags: ["组件", "工程化", "实战"] },
  { topic: "一次真实故障复盘：从报错到根因定位", tags: ["故障定位", "调试", "复盘"] },
  { topic: "旧方案 vs 新方案：我为什么最终改了架构", tags: ["对比", "架构", "决策"] },
  // 职场/成长
  { topic: "入职新公司第一个月，我做对了哪几件事", tags: ["职场", "方法论", "清单"] },
  { topic: "向上管理不是拍马屁：我怎么和老板同步预期", tags: ["职场", "沟通", "案例"] },
  { topic: "工作三年后我才明白的 5 个职场真相", tags: ["职场", "复盘", "成长"] },
  { topic: "从执行者到带人：角色切换最难的那一步", tags: ["职场", "管理", "成长"] },
  { topic: "如何在高压环境下保持稳定输出", tags: ["职场", "心态", "方法论"] },
  // 商业/创业
  { topic: "一个人能不能跑通一个小生意：我的尝试和数据", tags: ["商业", "创业", "复盘"] },
  { topic: "定价策略怎么定：我测试了 3 种方案后的结论", tags: ["商业", "定价", "对比"] },
  { topic: "从 0 用户到 1000 付费：冷启动阶段做对了什么", tags: ["商业", "增长", "案例"] },
  { topic: "小团队怎么做产品决策：资源有限时的取舍逻辑", tags: ["商业", "决策", "方法论"] },
  { topic: "我观察到的几个正在赚钱的小众赛道", tags: ["商业", "赛道", "案例"] },
  // 理财/投资
  { topic: "月薪一万五的理财策略：我的真实配置", tags: ["理财", "案例", "清单"] },
  { topic: "基金定投两年后的真实收益和心得", tags: ["理财", "投资", "复盘"] },
  { topic: "消费降级和生活品质的关系没你想的那么简单", tags: ["理财", "生活", "对比"] },
  { topic: "年轻人第一套房：我做决策时考虑了哪些因素", tags: ["理财", "决策", "案例"] },
  // 生活/效率
  { topic: "一套坚持了两年的晨间流程，我为什么没放弃", tags: ["生活", "习惯", "复盘"] },
  { topic: "极简生活不是扔东西：我的实践和边界", tags: ["生活", "方法论", "案例"] },
  { topic: "搬家 5 次后总结的租房避坑清单", tags: ["生活", "清单", "案例"] },
  { topic: "怎么在碎片时间里真正学到东西", tags: ["效率", "学习", "方法论"] },
  { topic: "我的信息摄入系统：从过载到可控", tags: ["效率", "工具链", "方法论"] },
  // 教育/学习
  { topic: "自学一门新技能，从入门到能用要多久", tags: ["教育", "学习", "复盘"] },
  { topic: "读了 50 本书后我改变了读书方法", tags: ["教育", "方法论", "复盘"] },
  { topic: "英语从日常够用到工作能用：我做了什么", tags: ["教育", "学习", "案例"] },
  { topic: "在线课程那么多，怎么判断值不值得买", tags: ["教育", "决策", "清单"] },
  // 健康/运动
  { topic: "久坐程序员的身体管理：我的最小可行方案", tags: ["健康", "清单", "方法论"] },
  { topic: "从跑不动 1 公里到完成半马：我用了多久", tags: ["健康", "运动", "复盘"] },
  { topic: "睡眠质量真的能优化吗：我试了这些方法", tags: ["健康", "对比", "案例"] },
  // 内容创作
  { topic: "写了 100 篇公众号后，我对选题的理解变了", tags: ["内容", "复盘", "方法论"] },
  { topic: "为什么同样的干货，有的阅读量差 10 倍", tags: ["内容", "案例", "对比"] },
  { topic: "个人 IP 冷启动：不花钱的前 1000 个关注者", tags: ["内容", "增长", "案例"] },
];

const HOT_TOPIC_SEEDS: Record<BlogSection | "all", string[]> = {
  all: [
    "AI Agent 真正在生产环境落地，会遇到哪些坑",
    "从提示词到工作流：今年最值得学的 AI 协作方式",
    "当模型变快但成本更高，你该怎么选型",
    "MCP 协议让工具调用标准化了，开发者该怎么用",
    "Claude Code / Cursor 这类 AI IDE 正在改变什么",
    "全栈项目里前后端契约怎么定，才不会互相拖后腿",
    "Next.js App Router 踩坑记：缓存和数据流那些事",
    "React Server Components 实战到底解决了什么问题",
    "流式交互体验升级：从 loading 到可中断生成",
    "前端工程里，如何平衡性能与可维护性",
    "把 LLM 嵌进现有后端：架构怎么切、超时怎么治",
    "Prompt Cache 和 Context Window 管理的工程实践",
    "个人知识库 + AI，到底该怎么搭才不吃灰",
    "TypeScript 项目规模变大后，类型策略怎么演进",
    "从脚本到平台：小自动化项目如何演进",
    "信息过载时代，工程师如何重建专注力",
  ],
  web: [
    "React Server Components \u5b9e\u6218\u5230\u5e95\u89e3\u51b3\u4e86\u4ec0\u4e48\u95ee\u9898",
    "\u524d\u7aef\u5de5\u7a0b\u91cc\uff0c\u5982\u4f55\u5e73\u8861\u6027\u80fd\u4e0e\u53ef\u7ef4\u62a4\u6027",
    "\u6d41\u5f0f\u4ea4\u4e92\u4f53\u9a8c\u5347\u7ea7\uff1a\u4ece loading \u5230\u53ef\u4e2d\u65ad\u751f\u6210",
    "Tailwind v4 \u5e26\u6765\u4e86\u54ea\u4e9b\u503c\u5f97\u8fc1\u79fb\u7684\u6539\u8fdb",
    "Next.js App Router \u8e29\u5751\u8bb0\uff1a\u7f13\u5b58\u548c\u6570\u636e\u6d41\u90a3\u4e9b\u4e8b",
    "\u524d\u7aef monorepo \u6cbb\u7406\uff1aTurborepo \u8fd8\u662f Nx",
    "Web Component \u5728 2026 \u8fd8\u503c\u5f97\u62bc\u6ce8\u5417",
    "Islands \u67b6\u6784 vs SPA\uff1a\u4ec0\u4e48\u65f6\u5019\u8be5\u7528\u90e8\u5206\u6c34\u5408",
  ],
  ui: [
    "\u8bbe\u8ba1\u7cfb\u7edf\u4e3a\u4ec0\u4e48\u5e38\u5e38\u843d\u5730\u5931\u8d25\uff1a\u771f\u5b9e\u539f\u56e0\u4e0e\u89e3\u6cd5",
    "\u7ec4\u4ef6\u5e93\u5347\u7ea7\u65f6\uff0c\u5982\u4f55\u907f\u514d\u4e00\u6539\u5168\u5d29",
    "\u53ef\u8bbf\u95ee\u6027\u4e0d\u662f\u9526\u4e0a\u6dfb\u82b1\uff1a\u4e00\u6b21\u6539\u9020\u524d\u540e\u5bf9\u6bd4",
    "AI \u8f85\u52a9 UI \u751f\u6210\uff08v0 / screenshot-to-code\uff09\u5b9e\u9645\u80fd\u7528\u5230\u4ec0\u4e48\u7a0b\u5ea6",
    "Design Token \u843d\u5730\u5168\u94fe\u8def\uff1a\u4ece Figma \u5230\u8fd0\u884c\u65f6",
    "\u6697\u9ed1\u6a21\u5f0f\u4e0d\u53ea\u662f\u6362\u8272\uff1a\u4e00\u5957\u65b9\u6848\u652f\u6491\u4e24\u79cd\u4e3b\u9898",
    "\u5fae\u52a8\u6548\u7684\u6027\u4ef7\u6bd4\uff1a\u54ea\u4e9b\u503c\u5f97\u505a\uff0c\u54ea\u4e9b\u662f\u8fc7\u5ea6\u8bbe\u8ba1",
  ],
  engineering: [
    "前端 monorepo 治理：Turborepo 还是 Nx",
    "GitHub Actions 进阶：矩阵构建、缓存与自托管 Runner",
    "从 package.json 到发布流水线：npm 发包踩坑清单",
    "工程化配置怎么分层：共享 presets 还是各仓自管",
    "YAML / Docker 入门后，本地环境还能怎么统一",
    "构建变慢怎么办：Vite / webpack 排查路径",
  ],
  backend: [
    "把 LLM 嵌进现有后端：架构怎么切、超时怎么治",
    "Node.js 服务稳定性：超时、重试与熔断怎么配",
    "MySQL 索引设计：我怎么用执行计划定位慢查询",
    "Prisma / ORM 落地：迁移与事务边界怎么定",
    "全栈项目里前后端契约怎么定，才不会互相拖后腿",
    "数据库连接池打满：一次真实排障复盘",
  ],
  tech: [
    "GitHub 高级搜索：我怎么在海量仓库里找答案",
    "Markdown 写作备忘：标题、表格与代码块约定",
    "资源收藏怎么整理才不吃灰",
    "个人知识库文档结构：我试过的三种目录法",
    "常用命令与速查表：怎么维护才跟得上工具更新",
  ],
  computer: [
    "\u4e00\u6b21\u7f51\u7edc\u8d85\u65f6\u6392\u969c\uff1a\u5982\u4f55\u5728 30 \u5206\u949f\u5185\u9501\u5b9a\u6839\u56e0",
    "\u6d4f\u89c8\u5668\u6027\u80fd\u95ee\u9898\u600e\u4e48\u505a\u6700\u5c0f\u590d\u73b0\u573a\u666f",
    "\u7cfb\u7edf\u6296\u52a8\u65f6\uff0c\u5148\u770b\u54ea\u4e9b\u6307\u6807\u6700\u6709\u4ef7\u503c",
    "\u5bb9\u5668 OOM \u6392\u67e5\uff1a\u4ece\u73b0\u8c61\u5230\u5b9a\u4f4d\u7684\u5b8c\u6574\u8def\u5f84",
    "TCP \u8fde\u63a5\u590d\u7528\u51fa\u4e86\u95ee\u9898\u600e\u4e48\u67e5",
    "CDN \u56de\u6e90\u6162\u7684\u51e0\u4e2a\u9690\u853d\u539f\u56e0",
    "Linux cgroup v2 \u5728\u5b9e\u9645\u9879\u76ee\u91cc\u600e\u4e48\u505a\u8d44\u6e90\u9694\u79bb",
  ],
  agent: [
    "从单次对话到可复用 Agent：我踩过的工程坑",
    "Cursor Rules / AGENTS.md 怎么写才真正约束模型",
    "MCP 工具接入后，权限和超时怎么设计",
    "多 Agent 协作：拆任务还是拆角色更稳",
    "提示词缓存与上下文裁剪：长会话还能不能控成本",
    "把 Agent 嵌进现有工作流：最小可用切入点",
  ],
  misc: [
    // 方法论/写作
    "为什么你的复盘总是流于形式",
    "高信息密度写作：把 1 篇讲清楚比 5 篇更重要",
    "技术博客怎么写才不像 AI 水文",
    "从写周报到写决策记录：让文档真正有用",
    // 职场
    "跳槽前想清楚这几件事，少走半年弯路",
    "你的「忙」有多少是在创造价值：时间审计实操",
    "会议太多怎么办：我砍掉 60% 会议后发生了什么",
    // 商业/副业
    "小红书 / 公众号 / 视频号：选哪个平台起步更合理",
    "知识付费还能做吗：一个小 IP 的真实收入结构",
    "一个人的电商小闭环：选品、流量、复购",
    // 生活
    "搬到新城市的前三个月怎么快速安顿",
    "极简数字生活：我删掉了 70% 的 App",
    "怎么跟不熟的人建立有效社交关系",
    // 学习
    "学完就忘怎么办：间隔重复的实际用法",
    "考证到底有没有用：投入产出比怎么算",
    // 健康
    "体检报告看不懂：常见指标异常的应对逻辑",
    "焦虑和压力管理：不是鸡汤，是具体方法",
  ],
};

export const IDEA_CATEGORY_LABELS: Record<TopicIdeasCategory, string> = {
  all: "综合",
  web: "前端",
  ai: "AI · Agent",
  backend: "后端 · 系统",
  career: "职场成长",
  business: "商业副业",
  life: "生活健康",
  writing: "写作内容",
};

type CategoryConfig = {
  label: string;
  llmTags: string[];
  seeds: string[];
  templateTags: string[];
  tech: boolean;
};

const IDEA_CATEGORIES: Record<TopicIdeasCategory, CategoryConfig> = {
  all: {
    label: "综合",
    llmTags: ["前端", "全栈", "AI", "Agent", "TypeScript", "工程化", "React", "效率"],
    seeds: HOT_TOPIC_SEEDS.all,
    templateTags: [],
    tech: true,
  },
  web: {
    label: "前端",
    llmTags: SECTION_TAGS.web,
    seeds: [...HOT_TOPIC_SEEDS.web, ...HOT_TOPIC_SEEDS.all.slice(0, 8)],
    templateTags: ["前端", "React", "Vue", "TypeScript", "组件", "工程化", "全栈", "性能"],
    tech: true,
  },
  ai: {
    label: "AI · Agent",
    llmTags: ["AI", "Agent", "LLM", "MCP", "提示词", "工作流", "模型", "Cursor", "效率工具"],
    seeds: [
      ...HOT_TOPIC_SEEDS.tech,
      ...HOT_TOPIC_SEEDS.agent,
      "本地优先 AI：从云 API 到端侧小模型的迁移场景",
      "RAG 之外：让 AI 真正用上你私有数据的几种工程方案",
      "AI 编程助手用了一年，代码质量和习惯发生了什么变化",
      "多模型路由与降级：怎么在成本和效果之间自动权衡",
      "Agent 的记忆与状态管理：长任务不跑偏的工程手段",
    ],
    templateTags: ["AI", "工作流", "自动化", "工具链", "实践", "Agent", "Cursor", "提示词", "MCP"],
    tech: true,
  },
  backend: {
    label: "后端 · 系统",
    llmTags: ["后端", "系统", "数据库", "架构", "性能", "网络", "调试", "Node", "Docker", "云原生"],
    seeds: [
      ...HOT_TOPIC_SEEDS.computer,
      "从单体到模块化：什么时候拆、拆到什么程度",
      "数据库连接池调优：一次线上抖动带来的参数级复盘",
      "接口设计规范是怎么从文档变成团队共识的",
      "服务无状态化改造：会话、缓存和扩展性的取舍",
      "定时任务系统设计：分布式环境下如何保证只执行一次",
    ],
    templateTags: ["系统", "网络", "性能", "浏览器", "调试", "故障定位", "后端", "架构", "Node", "决策"],
    tech: true,
  },
  career: {
    label: "职场成长",
    llmTags: ["职场", "成长", "管理", "沟通", "跳槽", "效率", "职业规划"],
    seeds: [
      "跳槽前想清楚这几件事，少走半年弯路",
      "你的「忙」有多少是在创造价值：时间审计实操",
      "会议太多怎么办：我砍掉 60% 会议后发生了什么",
      "向上管理不是拍马屁：我怎么和老板同步预期",
      "从执行者到带人：角色切换最难的那一步",
      "工作三年后我才明白的 5 个职场真相",
      "如何在高压环境下保持稳定输出",
      "入职新公司第一个月，我做对了哪几件事",
    ],
    templateTags: ["职场"],
    tech: false,
  },
  business: {
    label: "商业副业",
    llmTags: ["商业", "副业", "创业", "增长", "定价", "电商", "知识付费", "个人IP"],
    seeds: [
      "一个人能不能跑通一个小生意：我的尝试和数据",
      "定价策略怎么定：我测试了 3 种方案后的结论",
      "从 0 用户到 1000 付费：冷启动阶段做对了什么",
      "小团队怎么做产品决策：资源有限时的取舍逻辑",
      "我观察到的几个正在赚钱的小众赛道",
      "小红书 / 公众号 / 视频号：选哪个平台起步更合理",
      "知识付费还能做吗：一个小 IP 的真实收入结构",
      "一个人的电商小闭环：选品、流量、复购",
    ],
    templateTags: ["商业", "创业", "定价", "赛道", "增长"],
    tech: false,
  },
  life: {
    label: "生活健康",
    llmTags: ["生活", "健康", "效率", "习惯", "理财", "学习", "运动", "心态"],
    seeds: [
      "月薪一万五的理财策略：我的真实配置",
      "基金定投两年后的真实收益和心得",
      "极简生活不是扔东西：我的实践和边界",
      "搬家 5 次后总结的租房避坑清单",
      "久坐程序员的身体管理：我的最小可行方案",
      "从跑不动 1 公里到完成半马：我用了多久",
      "睡眠质量真的能优化吗：我试了这些方法",
      "自学一门新技能，从入门到能用要多久",
    ],
    templateTags: ["生活", "习惯", "健康", "运动", "理财", "投资", "教育", "学习", "效率"],
    tech: false,
  },
  writing: {
    label: "写作内容",
    llmTags: ["写作", "内容", "选题", "公众号", "复盘", "IP", "方法论"],
    seeds: [
      "写了 100 篇公众号后，我对选题的理解变了",
      "为什么同样的干货，有的阅读量差 10 倍",
      "个人 IP 冷启动：不花钱的前 1000 个关注者",
      "高信息密度写作：把 1 篇讲清楚比 5 篇更重要",
      "技术博客怎么写才不像 AI 水文",
      "从写周报到写决策记录：让文档真正有用",
      "内容复利：一篇旧文如何持续带来新读者",
      "公众号排版与完读率：被低估的几个细节",
    ],
    templateTags: ["内容"],
    tech: false,
  },
};

function toCategory(v: string | null | undefined): TopicIdeasCategory {
  if (v && v in IDEA_CATEGORIES) return v as TopicIdeasCategory;
  return "all";
}

/** 近期已展示选题记忆：同一用户短期内不重复推同一批 */
const SEEN_TTL_MS = 12 * 60 * 60 * 1000;
const SEEN_MAX_PER_USER = 120;
const seenStore = new Map<string, { topic: string; at: number }[]>();

function pruneSeen(now = Date.now()) {
  for (const [userId, list] of seenStore) {
    const alive = list.filter((item) => now - item.at < SEEN_TTL_MS);
    if (alive.length === 0) seenStore.delete(userId);
    else if (alive.length !== list.length) seenStore.set(userId, alive);
  }
}

function getSeenTopics(userId: string, now = Date.now()): string[] {
  pruneSeen(now);
  const list = seenStore.get(userId);
  if (!list) return [];
  return list
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, 40)
    .map((item) => item.topic);
}

function recordSeenTopics(userId: string, topics: string[], now = Date.now()) {
  if (!userId || topics.length === 0) return;
  pruneSeen(now);
  const prev = seenStore.get(userId) ?? [];
  const seen = new Set(prev.map((item) => normalizeTopic(item.topic)));
  const next = [...prev];
  for (const topic of topics) {
    const key = normalizeTopic(topic);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push({ topic: key, at: now });
  }
  if (next.length > SEEN_MAX_PER_USER) {
    seenStore.set(userId, next.slice(next.length - SEEN_MAX_PER_USER));
  } else if (next.length !== prev.length) {
    seenStore.set(userId, next);
  }
}

const HISTORY_TEMPLATES: Array<{ suffix: string; reason: string; tag: string; score: number }> = [
  { suffix: "\uff1a\u6211\u4f1a\u5148\u505a\u7684 3 \u4e2a\u5173\u952e\u52a8\u4f5c", reason: "\u5ef6\u5c55\u6210\u53ef\u6267\u884c\u6e05\u5355\u3002", tag: "\u6e05\u5355", score: 0.82 },
  { suffix: "\u91cc\u6700\u5bb9\u6613\u5ffd\u7565\u7684\u4e00\u4e2a\u7cfb\u7edf\u6027\u95ee\u9898", reason: "\u6362\u6210\u95ee\u9898\u5b9a\u4f4d\u89d2\u5ea6\u3002", tag: "\u95ee\u9898\u5bfc\u5411", score: 0.79 },
  { suffix: "\u65e7\u65b9\u6848 vs \u65b0\u65b9\u6848\uff1a\u5b9e\u6d4b\u5dee\u5f02\u5728\u54ea\u91cc", reason: "\u7528\u5bf9\u6bd4\u7ed3\u6784\u63d0\u9ad8\u53ef\u8bfb\u6027\u3002", tag: "\u5bf9\u6bd4", score: 0.77 },
  { suffix: "\uff1a\u4e00\u6b21\u771f\u5b9e\u8e29\u5751\u4e0e\u4fee\u590d\u8fc7\u7a0b", reason: "\u7528\u6545\u4e8b\u7ebf\u964d\u4f4e\u9605\u8bfb\u95e8\u69db\u3002", tag: "\u6545\u4e8b", score: 0.78 },
  { suffix: "\uff1a\u7ed9\u521a\u5165\u95e8\u7684\u4eba\u5199\u4e00\u4efd\u907f\u5751\u6e05\u5355", reason: "\u6362\u6210\u5165\u95e8\u89c6\u89d2\u6269\u5927\u8bfb\u8005\u9762\u3002", tag: "\u5165\u95e8", score: 0.76 },
  { suffix: "\u7684\u8fb9\u754c\u5728\u54ea\u91cc\uff1f\u4ec0\u4e48\u65f6\u5019\u4e0d\u8be5\u7528", reason: "\u4ece\u4e0d\u9002\u7528\u89d2\u5ea6\u5207\u5165\u66f4\u6709\u4fe1\u606f\u91cf\u3002", tag: "\u8fb9\u754c", score: 0.80 },
  { suffix: "\uff1a\u5982\u679c\u53ea\u80fd\u4fdd\u7559\u4e00\u4e2a\u6838\u5fc3\u505a\u6cd5", reason: "\u6781\u7b80\u89c6\u89d2\u903c\u51fa\u6700\u91cd\u8981\u7684\u4e00\u70b9\u3002", tag: "\u6781\u7b80", score: 0.75 },
  { suffix: "\u534a\u5e74\u540e\u56de\u770b\uff0c\u54ea\u4e9b\u5224\u65ad\u53d8\u4e86", reason: "\u65f6\u95f4\u7ef4\u5ea6\u590d\u76d8\u4f53\u73b0\u8ba4\u77e5\u8fed\u4ee3\u3002", tag: "\u590d\u76d8", score: 0.74 },
  { suffix: "\uff1a\u6211\u4ece\u5931\u8d25\u6848\u4f8b\u91cc\u5b66\u5230\u7684\u6bd4\u6210\u529f\u591a", reason: "\u5931\u8d25\u53d9\u4e8b\u66f4\u6709\u5171\u9e23\u3002", tag: "\u5931\u8d25\u6848\u4f8b", score: 0.77 },
  { suffix: "\u5728\u56e2\u961f\u91cc\u600e\u4e48\u63a8\uff0c\u963b\u529b\u6765\u81ea\u54ea", reason: "\u52a0\u5165\u534f\u4f5c\u89c6\u89d2\u589e\u52a0\u5b9e\u7528\u6027\u3002", tag: "\u534f\u4f5c", score: 0.73 },
  { suffix: "\uff1a\u6027\u80fd\u4f18\u5316\u524d\u540e\u7684\u5173\u952e\u6570\u5b57\u5bf9\u6bd4", reason: "\u7528\u6570\u636e\u9a71\u52a8\u53d9\u4e8b\u3002", tag: "\u6027\u80fd", score: 0.76 },
  { suffix: "\u80cc\u540e\u7684\u8bbe\u8ba1\u51b3\u7b56\uff1a\u4e3a\u4ec0\u4e48\u8fd9\u6837\u800c\u4e0d\u90a3\u6837", reason: "\u63a2\u8ba8 why \u800c\u975e how\u3002", tag: "\u51b3\u7b56", score: 0.78 },
];

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAt: number; value: TopicIdeasResult }>();
const inflight = new Map<string, Promise<TopicIdeasResult>>();

function seededHash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

function seededRandom(seed: number): () => number {
  let x = seed % 2147483647;
  if (x <= 0) x += 2147483646;
  return () => {
    x = (x * 16807) % 2147483647;
    return (x - 1) / 2147483646;
  };
}

function normalizeTopic(input: string): string {
  return input
    .trim()
    .replace(/[\u300a\u300b\u3010\u3011\uff08\uff09()]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 48);
}

function extractTokens(text: string): string[] {
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9][a-z0-9.+-]{1,20}/g) ?? [];
  const zh = text.match(/[\u4e00-\u9fa5]{2,8}/g) ?? [];
  return [...latin, ...zh].map((t) => t.trim()).filter(Boolean);
}

function similarity(a: string, b: string): number {
  const sa = new Set(extractTokens(a));
  const sb = new Set(extractTokens(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) {
    if (sb.has(x)) inter += 1;
  }
  return inter / Math.max(sa.size, sb.size);
}

function buildHistoryCandidates(
  historyTopics: string[],
  section: BlogSection | null,
  rnd: () => number,
): Candidate[] {
  const seeds = historyTopics.slice(0, 10);
  const ideas: Candidate[] = [];

  // Shuffle templates per call so each "refresh" picks different angles
  const shuffled = [...HISTORY_TEMPLATES].sort(() => rnd() - 0.5);

  for (let si = 0; si < seeds.length; si++) {
    const core = seeds[si].replace(/[\uff1f?\uff01!\u3002\uff1a:]/g, "").slice(0, 18);
    if (!core || core.length < 4) continue;
    // Each seed picks only 1-2 templates, cycling through shuffled list
    const tpl = shuffled[(si * 2) % shuffled.length];
    // 每个历史主题只延伸 1 条，避免「同一旧题套多种后缀」刷屏
    ideas.push({
      topic: `${core}${tpl.suffix}`,
      reason: `\u6765\u81ea\u4f60\u6700\u8fd1\u6587\u7ae0\u65b9\u5411\uff0c${tpl.reason}`,
      source: "history",
      tags: ["\u5386\u53f2\u504f\u597d", tpl.tag],
      baseScore: tpl.score - 0.08,
    });
  }

  if (section) {
    const tags = SECTION_TAGS[section];
    ideas.push({
      topic: `${tags[0]}\u65b9\u5411\u6700\u8fd1\u503c\u5f97\u505a\u7684\u4e00\u6b21\u590d\u76d8`,
      reason: `\u7ed3\u5408\u4f60\u5e38\u5199\u680f\u76ee\u300c${section}\u300d\u8865\u4e00\u4e2a\u7a33\u59a5\u9009\u9898\u3002`,
      source: "history",
      tags: [section, "\u590d\u76d8"],
      baseScore: 0.72,
    });
  }

  return ideas;
}

function buildTemplateCandidates(
  section: BlogSection | null,
  rnd: () => number,
  category?: TopicIdeasCategory,
): Candidate[] {
  const sectionTags = section ? new Set(SECTION_TAGS[section]) : null;
  const categoryTags =
    category && category !== "all" ? new Set(IDEA_CATEGORIES[category].templateTags) : null;
  let pool = TEMPLATE_TOPICS.filter(
    (item) =>
      (!sectionTags || item.tags.some((t) => sectionTags.has(t))) &&
      (!categoryTags || item.tags.some((t) => categoryTags.has(t))),
  );

  // 综合入口：技术模板占主体，综合类只留少量
  if (!section && (!category || category === "all")) {
    const tech = pool.filter((item) => isTechHeavyCandidate({ topic: item.topic, tags: item.tags }));
    const general = pool.filter((item) => !isTechHeavyCandidate({ topic: item.topic, tags: item.tags }));
    const generalPick = [...general].sort(() => rnd() - 0.5).slice(0, Math.max(3, Math.floor(general.length * 0.2)));
    pool = [...tech, ...generalPick];
  }

  return pool.map((item) => ({
    topic: item.topic,
    reason: isTechHeavyCandidate({ topic: item.topic, tags: item.tags })
      ? "偏向前端 / AI / 工程向，适合快速开写。"
      : "来自稳定模板库，适合快速开写。",
    source: "template" as const,
    tags: item.tags,
    baseScore: isTechHeavyCandidate({ topic: item.topic, tags: item.tags }) ? 0.74 : 0.58,
  }));
}

function buildHotCandidates(seeds: string[], rnd: () => number): Candidate[] {
  const shuffledSeeds = [...seeds].sort(() => rnd() - 0.5);
  return shuffledSeeds
    .filter((topic) => assessTopicIdeaQuality(topic).ok)
    .map((topic) => ({
      topic,
      reason: TECH_AFFINITY_RE.test(topic)
        ? "工程向种子题，可改成你自己的踩坑或选型角度。"
        : "分类种子题，建议结合你的真实场景再落笔。",
      source: "hot" as const,
      tags: TECH_AFFINITY_RE.test(topic) ? ["热点", "工程"] : ["热点"],
      baseScore: TECH_AFFINITY_RE.test(topic) ? 0.72 : 0.58,
    }));
}

type LlmHotTopic = { topic: string; angle: string; tags: string[] };

/** 无栏目时默认偏向前端 / AI / 全栈 */
const DEFAULT_FOCUS_TAGS = ["前端", "全栈", "AI", "Agent", "TypeScript", "工程化", "React", "效率"];

const TECH_AFFINITY_RE =
  /前端|全栈|React|Vue|Next|TypeScript|JavaScript|CSS|Node|AI|Agent|Cursor|MCP|LLM|工程|组件|性能|浏览器|调试|提示词|工作流|自动化|接口|API|后端|数据库|Docker|Git/i;
const GENERAL_AFFINITY_RE =
  /理财|基金|租房|体检|副业|跳槽|月薪|极简生活|英语|晨间|睡眠|半马|买房|电商|小红书|视频号|知识付费|焦虑|会议太多|搬家/i;

const TECH_TAG_SET = new Set([
  "前端",
  "React",
  "Vue",
  "TypeScript",
  "组件",
  "工程化",
  "UI",
  "CSS",
  "设计系统",
  "交互",
  "可访问性",
  "动效",
  "AI",
  "效率",
  "工作流",
  "自动化",
  "工具链",
  "实践",
  "系统",
  "网络",
  "性能",
  "浏览器",
  "调试",
  "故障定位",
  "Agent",
  "Cursor",
  "提示词",
  "MCP",
  "AI 热点",
  "热点",
  "全栈",
  "Node",
  "后端",
]);

const GENERAL_TAG_SET = new Set([
  "职场",
  "理财",
  "投资",
  "生活",
  "健康",
  "运动",
  "教育",
  "商业",
  "创业",
  "成长",
  "心态",
  "内容",
  "增长",
  "定价",
  "赛道",
  "消费",
  "习惯",
  "学习",
  "沟通",
  "管理",
]);

function isTechHeavyCandidate(c: Pick<Candidate, "topic" | "tags">): boolean {
  if (TECH_AFFINITY_RE.test(c.topic)) return true;
  if (GENERAL_AFFINITY_RE.test(c.topic)) return false;
  return c.tags.some((t) => TECH_TAG_SET.has(t));
}

function techAffinityBonus(c: Pick<Candidate, "topic" | "tags">): number {
  let bonus = 0;
  for (const t of c.tags) {
    if (TECH_TAG_SET.has(t)) bonus += 0.08;
    if (GENERAL_TAG_SET.has(t)) bonus -= 0.12;
  }
  if (TECH_AFFINITY_RE.test(c.topic)) bonus += 0.1;
  if (GENERAL_AFFINITY_RE.test(c.topic)) bonus -= 0.18;
  return bonus;
}

/** LLM 热点缓存：按 section 缓存 1 小时，避免每次刷新都调用模型 */
const LLM_HOT_CACHE_TTL_MS = 60 * 60 * 1000;
const llmHotCache = new Map<string, { expiresAt: number; topics: LlmHotTopic[] }>();
const llmHotInflight = new Map<string, Promise<LlmHotTopic[]>>();

type DbHotRow = { topicsJson: unknown; expiresAt: Date };

/**
 * 从 DB 读热点缓存；行不存在 / 过期 / JSON 解析失败都返回 null。
 * 一并返回 expiresAt，调用方回填内存缓存时要沿用它，不能重置成完整 TTL。
 */
async function readDbHotCache(
  key: string,
): Promise<{ topics: LlmHotTopic[]; expiresAt: number } | null> {
  try {
    const row = await db.hotTopicCache.findUnique({
      where: { cacheKey: key },
      select: { topicsJson: true, expiresAt: true },
    }) as DbHotRow | null;
    if (!row) return null;
    const expiresAt = row.expiresAt.getTime();
    if (expiresAt <= Date.now()) return null;
    const parsed = row.topicsJson;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return { topics: parsed as LlmHotTopic[], expiresAt };
  } catch {
    return null;
  }
}

async function writeDbHotCache(
  key: string,
  section: BlogSection | null,
  category: TopicIdeasCategory | null,
  topics: LlmHotTopic[],
): Promise<void> {
  await db.hotTopicCache.upsert({
    where: { cacheKey: key },
    create: {
      cacheKey: key,
      section: section ?? null,
      category: category ?? null,
      topicsJson: topics,
      expiresAt: new Date(Date.now() + LLM_HOT_CACHE_TTL_MS),
    },
    update: {
      topicsJson: topics,
      expiresAt: new Date(Date.now() + LLM_HOT_CACHE_TTL_MS),
    },
  });
}

/**
 * 拉取 LLM 生成的当下热点选题。
 * 默认命中 1 小时缓存；`force` 时强制重新调用模型（用于「换一批」）。
 *
 * 缓存分两层：
 * - 进程内 Map：本地热点命中，避免一次请求里的多次重复查询
 * - DB HotTopicCache：跨实例共享，避免多容器各调一次 LLM
 *
 * 查库放在 inflight Promise 内部：查库是异步的，若放在外面，同实例的并发请求
 * 会在 await 处交错、各自 miss inflight，最后各调一次 LLM。
 */
async function fetchLlmHotTopics(
  section: BlogSection | null,
  count: number,
  opts?: {
    force?: boolean;
    batch?: number;
    category?: TopicIdeasCategory;
    avoid?: string[];
    persona?: string;
    recentTopics?: string[];
    intent?: "fresh" | "history-extend";
  },
): Promise<LlmHotTopic[]> {
  const category = opts?.category ?? "all";
  const intent = opts?.intent ?? "fresh";
  // persona / 近期主题参与缓存键，避免不同人设共用同一批「技术热点」
  const personaKey = (opts?.persona ?? "").slice(0, 40);
  const key = `${section ?? "all"}:${category}:${intent}:${personaKey || "nopersona"}`;
  const force = Boolean(opts?.force);
  const batch = opts?.batch ?? 0;
  const avoid = opts?.avoid ?? [];

  if (!force) {
    const memCached = llmHotCache.get(key);
    if (memCached && memCached.expiresAt > Date.now()) {
      return memCached.topics.slice(0, count);
    }
    const pending = llmHotInflight.get(key);
    if (pending) {
      const topics = await pending;
      return topics.slice(0, count);
    }
  }

  const inflightKey = force ? `${key}:force:${batch}:${Date.now()}` : key;
  const task = (async (): Promise<LlmHotTopic[]> => {
    try {
      if (!force) {
        const dbCached = await readDbHotCache(key);
        if (dbCached) {
          llmHotCache.set(key, {
            expiresAt: dbCached.expiresAt,
            topics: dbCached.topics,
          });
          return dbCached.topics;
        }
      }

      const cat = IDEA_CATEGORIES[category];
      const sectionTags =
        category !== "all"
          ? cat.llmTags
          : opts?.persona
            ? cat.llmTags.slice(0, 4)
            : section
              ? SECTION_TAGS[section]
              : DEFAULT_FOCUS_TAGS;

      const rawTopics = await generateHotTopics({
        section,
        sectionTags,
        categoryLabel: cat.label,
        avoid,
        persona: opts?.persona,
        recentTopics: opts?.recentTopics,
        intent,
        count: Math.min(10, count + 3),
        batch,
      });
      const topics = rawTopics.filter((t) => assessTopicIdeaQuality(t.topic, t.angle).ok);
      if (topics.length > 0) {
        const expiresAt = Date.now() + LLM_HOT_CACHE_TTL_MS;
        llmHotCache.set(key, { expiresAt, topics });
        writeDbHotCache(key, section, category, topics).catch((err) => {
          console.warn(
            "[topic-ideas] writeDbHotCache failed:",
            err instanceof Error ? err.message : err,
          );
        });
        return topics;
      }
      if (force) {
        const stale = llmHotCache.get(key);
        if (stale?.topics.length) return stale.topics;
      }
      return [];
    } catch (error) {
      console.warn(
        "[topic-ideas] fetchLlmHotTopics failed, fallback to static seeds:",
        error instanceof Error ? error.message : error,
      );
      if (force) {
        const stale = llmHotCache.get(key);
        if (stale?.topics.length) return stale.topics;
      }
      return [];
    } finally {
      llmHotInflight.delete(inflightKey);
      if (!force) llmHotInflight.delete(key);
    }
  })();

  llmHotInflight.set(inflightKey, task);
  if (!force) llmHotInflight.set(key, task);
  const topics = await task;
  return topics.slice(0, count);
}

/** LLM 热点候选：baseScore 高于静态热点（0.7），让新鲜选题优先展示 */
function buildLlmHotCandidates(llmTopics: LlmHotTopic[]): Candidate[] {
  return llmTopics.map((t) => {
    const quality = assessTopicIdeaQuality(t.topic, t.angle);
    return {
      topic: t.topic,
      reason: t.angle || "具体冲突清晰，适合直接开写一版大纲。",
      source: "hot" as const,
      tags: t.tags.length > 0 ? ["AI 热点", ...t.tags].slice(0, 4) : ["AI 热点"],
      baseScore: Math.min(0.94, 0.82 + quality.score * 0.12),
    };
  });
}

function buildMixedCandidates(
  historyTopics: string[],
  includeHot: boolean,
  rnd: () => number,
): Candidate[] {
  const base = historyTopics.slice(0, 6);
  const allHot = [...HOT_TOPIC_SEEDS.all].sort(() => rnd() - 0.5);
  const out: Candidate[] = [];

  // 统一签名 (已有主题, 热点) => 标题；部分模板只用到主题，省略第二个参数
  const mixTemplates: Array<(a: string, h: string) => string> = [
    (a) => `${a}\u5728\u4eca\u5e74\u65b0\u8d8b\u52bf\u4e0b\uff0c\u5e94\u8be5\u600e\u4e48\u8c03\u6574`,
    (a, h) => `\u7528\u300c${h.slice(0, 14)}\u300d\u7684\u601d\u8def\u91cd\u65b0\u5ba1\u89c6${a}`,
    (a, h) => `${a}\u548c${h.slice(0, 12)}\u7684\u4ea4\u53c9\u70b9\u5728\u54ea`,
    (a) => `\u5982\u679c\u8ba9\u6211\u91cd\u65b0\u505a\u4e00\u6b21${a}`,
    (a) => `${a}\u7684\u4e0b\u4e00\u6b65\uff1a\u6211\u8ba1\u5212\u600e\u4e48\u8fed\u4ee3`,
  ];

  for (let i = 0; i < base.length; i++) {
    const a = base[i].replace(/[\uff1a:]/g, "").slice(0, 16);
    if (!a || a.length < 4) continue;
    const h = includeHot ? allHot[i % allHot.length] : "\u5b9e\u6218\u590d\u76d8";
    const tplFn = mixTemplates[Math.floor(rnd() * mixTemplates.length)];
    out.push({
      topic: tplFn(a, h),
      reason: `\u6df7\u5408\u4f60\u65e2\u6709\u4e3b\u9898\u4e0e${includeHot ? "\u70ed\u70b9\u65b9\u5411" : "\u5f53\u524d\u8d8b\u52bf"}\uff0c\u964d\u4f4e\u9009\u9898\u95e8\u69db\u3002`,
      source: "mixed",
      tags: ["\u6df7\u5408", includeHot ? "\u70ed\u70b9" : "\u8d8b\u52bf"],
      baseScore: 0.73 + rnd() * 0.04,
    });
  }
  return out;
}

export type PersonaBias = "tech" | "general" | "mixed";

/** 根据账号人设推断综合入口该偏技术还是综合向 */
export function inferPersonaBias(persona: string | null | undefined): PersonaBias {
  const p = (persona ?? "").trim();
  if (!p) return "tech";
  const general = /职场|商业|生活|写作|理财|育儿|健康|副业|内容|成长|公众号运营/.test(p);
  const tech = /前端|后端|全栈|AI|Agent|工程|程序员|开发|TypeScript|React|Node/.test(p);
  if (general && !tech) return "general";
  if (tech && !general) return "tech";
  if (general && tech) return "mixed";
  return "mixed";
}

const FORMULAIC_TOPIC_RE =
  /我会先做的\s*\d+\s*个|旧方案\s*vs\s*新方案|给刚入门的人写|避坑清单$|关键动作$/;

const WEAK_TOPIC_RE =
  /AI\s*时代|大模型趋势|赋能|闭环|底层逻辑|深度好文|全面解析|你必须知道|必看|震惊|如何提升效率$|职场真相|认知升级|打造个人品牌(?!.*具体)/u;

const WEAK_REASON_RE = /很火|值得关注|大家都很关心|持续升温|热度不减|趋势明显/u;

/** 选题质量闸门：过空/鸡汤/公式题直接丢 */
export function assessTopicIdeaQuality(topic: string, reason?: string): {
  ok: boolean;
  score: number;
  issues: string[];
} {
  const t = topic.trim();
  const issues: string[] = [];
  let score = 1;
  if (t.length < 10 || t.length > 28) {
    issues.push("长度不宜");
    score -= 0.35;
  }
  if (WEAK_TOPIC_RE.test(t) || FORMULAIC_TOPIC_RE.test(t)) {
    issues.push("空泛或公式题");
    score -= 0.55;
  }
  if (/[！!]{2,}|\?{2,}|？{2,}/.test(t)) {
    issues.push("标题党标点");
    score -= 0.3;
  }
  // 缺具体张力词时略降权（不完全拒）
  if (!/[？?：:]|还是|还是该|别再|不要|何时|什么时候|坑|代价|边界|取舍|对比|vs|VS/.test(t)) {
    score -= 0.08;
  }
  if (reason && WEAK_REASON_RE.test(reason)) {
    issues.push("理由空泛");
    score -= 0.2;
  }
  return { ok: score >= 0.45 && !issues.includes("空泛或公式题"), score, issues };
}

/**
 * Dedupe + inter-candidate similarity filter + rank.
 * 综合入口按人设偏置；批内相似度阈值更严，减少「换皮重复」。
 */
function dedupeAndRank(
  candidates: Candidate[],
  historyTopics: string[],
  count: number,
  seed: number,
  opts?: {
    general?: boolean;
    seen?: Set<string>;
    personaBias?: PersonaBias;
  },
): TopicIdea[] {
  let pool = candidates;
  if (opts?.seen && opts.seen.size > 0) {
    const fresh = candidates.filter((c) => !opts.seen!.has(normalizeTopic(c.topic)));
    pool = fresh.length >= Math.min(count, 4) ? fresh : [...fresh, ...candidates];
  }

  const deduped = new Map<string, Candidate>();
  for (const c of pool) {
    const topic = normalizeTopic(c.topic);
    if (!topic || topic.length < 6) continue;
    const quality = assessTopicIdeaQuality(topic, c.reason);
    if (!quality.ok) continue;
    const key = topic.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, { ...c, topic, baseScore: c.baseScore + (quality.score - 0.7) * 0.1 });
    }
  }

  const bias = opts?.personaBias ?? (opts?.general ? "general" : "tech");
  const rnd = seededRandom(seed + 99);
  const scored = [...deduped.values()].map((c) => {
    const maxSim = historyTopics.reduce((m, h) => Math.max(m, similarity(c.topic, h)), 0);
    const noveltyBonus = Math.max(0, 0.2 - maxSim * 0.28);
    const jitter = (rnd() - 0.5) * 0.1;
    let affinity = 0;
    if (bias === "general") affinity = -techAffinityBonus(c);
    else if (bias === "tech") affinity = techAffinityBonus(c);
    else affinity = techAffinityBonus(c) * 0.25;
    // LLM 热点优先于静态模板 / 机械历史后缀
    const sourceBonus =
      c.source === "hot" && c.tags.includes("AI 热点")
        ? 0.08
        : c.source === "template"
          ? -0.06
          : c.source === "history"
            ? -0.05
            : 0;
    const score = Math.max(
      0.25,
      Math.min(0.99, c.baseScore + noveltyBonus + jitter + affinity + sourceBonus),
    );
    return {
      topic: c.topic,
      reason: c.reason,
      source: c.source,
      tags: c.tags,
      score: Number(score.toFixed(3)),
      tech: isTechHeavyCandidate(c),
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const generalCap =
    bias === "general"
      ? Infinity
      : bias === "mixed"
        ? Math.max(2, Math.ceil(count * 0.45))
        : Math.max(1, Math.floor(count * 0.25));
  const simThreshold = 0.36;
  const result: TopicIdea[] = [];
  let generalCount = 0;

  for (const item of scored) {
    if (result.length >= count) break;
    const tooSimilar = result.some((r) => similarity(r.topic, item.topic) > simThreshold);
    if (tooSimilar) continue;
    if (!item.tech) {
      if (generalCount >= generalCap) continue;
      generalCount += 1;
    }
    result.push({
      topic: item.topic,
      reason: item.reason,
      source: item.source,
      tags: item.tags,
      score: item.score,
    });
  }

  if (result.length < count) {
    for (const item of scored) {
      if (result.length >= count) break;
      if (result.some((r) => r.topic === item.topic)) continue;
      const tooSimilar = result.some((r) => similarity(r.topic, item.topic) > simThreshold);
      if (tooSimilar) continue;
      result.push({
        topic: item.topic,
        reason: item.reason,
        source: item.source,
        tags: item.tags,
        score: item.score,
      });
    }
  }

  return result;
}

function makeCacheKey(input: {
  userId: string;
  count: number;
  mode: TopicIdeasMode;
  cursor: number;
  section: BlogSection | "all";
  category: TopicIdeasCategory;
}) {
  return `${input.userId}|${input.section}|${input.count}|${input.mode}|${input.cursor}|${input.category}`;
}

function toBlogSection(v: string | null | undefined): BlogSection | null {
  if (!v) return null;
  return (BLOG_SECTIONS as readonly string[]).includes(v) ? (v as BlogSection) : null;
}

function resolveMode(input: TopicIdeasRequest): TopicIdeasMode {
  if (input.mode === "all" || input.mode === "history" || input.mode === "hot") {
    return input.mode;
  }
  if (input.includeHot === false) return "history";
  return "all";
}

export async function getTopicIdeas(input: TopicIdeasRequest): Promise<TopicIdeasResult> {
  const count = Math.max(4, Math.min(16, input.count ?? 8));
  const mode = resolveMode(input);
  const includeHot = mode === "all" || mode === "hot";
  const refresh = Boolean(input.refresh);
  const section = toBlogSection(input.section ?? null);
  const cursor = Number.isFinite(input.cursor) ? Math.max(0, Number(input.cursor)) : 0;
  const category = toCategory(input.category ?? null);
  const seenTopics = getSeenTopics(input.userId);
  const key = makeCacheKey({
    userId: input.userId,
    count,
    mode,
    section: section ?? "all",
    cursor,
    category,
  });

  // 换一批强制走新生成，不吃结果缓存
  if (!refresh) {
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.value, fromCache: true };
    }
  }

  const pending = inflight.get(key);
  if (pending && !refresh) return pending;

  const task = (async (): Promise<TopicIdeasResult> => {
    const persona = getAccountPersona();
    const personaBias =
      category === "all"
        ? inferPersonaBias(persona)
        : IDEA_CATEGORIES[category].tech
          ? "tech"
          : "general";

    const recent = await db.article.findMany({
      where: { userId: input.userId },
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: {
        topic: true,
        title: true,
        keywords: true,
      },
    });

    const historyTopics = recent
      .map((a) => (a.title?.trim() || a.topic || "").trim())
      .filter(Boolean)
      .slice(0, 24);

    // 历史主题也加入 avoid，减少「刚写过的题换皮再推」
    const avoid = [...new Set([...seenTopics, ...historyTopics])].slice(0, 24);

    const wantLlm = includeHot || (mode === "history" && historyTopics.length > 0);
    const llmHotTopics = wantLlm
      ? await fetchLlmHotTopics(section, mode === "hot" || mode === "history" ? 10 : 8, {
          force: refresh,
          batch: cursor,
          category: mode === "history" ? "all" : category,
          avoid,
          persona,
          recentTopics: historyTopics.slice(0, 8),
          intent: mode === "history" ? "history-extend" : "fresh",
        })
      : [];

    const seed = seededHash(
      `${input.userId}-${Date.now()}-${cursor}-${mode}-${section ?? "all"}-${category}-${persona.slice(0, 24)}-${refresh ? "r" : "c"}`,
    );
    const rnd = seededRandom(seed);

    const history = buildHistoryCandidates(historyTopics, section, rnd);
    const templates = buildTemplateCandidates(section, rnd, category);
    const mixed = buildMixedCandidates(historyTopics, includeHot, rnd);
    const llmHot = buildLlmHotCandidates(llmHotTopics);
    const hot = includeHot ? buildHotCandidates(IDEA_CATEGORIES[category].seeds, rnd) : [];

    let pool: Candidate[] = [];
    let emptyReason: string | null = null;

    if (mode === "history") {
      if (historyTopics.length === 0) {
        emptyReason = "还没有历史文章。先写几篇，或切换到「热点」看看当下选题。";
        pool = [];
      } else if (llmHot.length >= 3) {
        // 历史模式优先 LLM 新角度，后缀模板只作补位
        pool = [...llmHot, ...history.slice(0, 2)];
      } else {
        pool = [...llmHot, ...history.slice(0, Math.max(4, count)), ...mixed.slice(0, 2)];
        if (pool.length === 0) {
          emptyReason = "暂时没法从历史文章延伸出选题，试试「综合」或「热点」。";
        }
      }
    } else if (mode === "hot") {
      pool = llmHot.length >= 4 ? [...llmHot, ...hot.slice(0, 2)] : [...llmHot, ...hot];
      if (pool.length === 0) {
        emptyReason = "热点暂时不可用，请稍后重试或切到「综合」。";
      }
    } else if (llmHot.length >= 4) {
      // LLM 够用时压低静态模板/机械混合，避免整页同一批种子
      pool = [...llmHot, ...templates.slice(0, 1), ...hot.slice(0, 1)];
    } else {
      pool = [...llmHot, ...history.slice(0, 3), ...templates, ...hot];
    }

    const general = personaBias === "general";
    const seen = new Set(seenTopics);
    const ideas =
      pool.length === 0
        ? []
        : dedupeAndRank(pool, historyTopics, count, seed, {
            general,
            seen,
            personaBias,
          });

    recordSeenTopics(
      input.userId,
      ideas.map((i) => i.topic),
    );

    const result: TopicIdeasResult = {
      ideas,
      fromCache: false,
      degradedHot: includeHot && llmHotTopics.length === 0,
      mode,
      emptyReason: ideas.length === 0 ? emptyReason : null,
    };
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
    return result;
  })()
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, task);
  return task;
}
