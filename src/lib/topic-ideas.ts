import type { BlogSection } from "@/lib/blog-sync-constants";
import { BLOG_SECTIONS } from "@/lib/blog-sync-constants";
import { db } from "@/lib/db";
import { generateHotTopics } from "@/lib/ai";

export type TopicIdeaSource = "history" | "template" | "hot" | "mixed";

export type TopicIdeasMode = "all" | "history" | "hot";

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
  web: ["前端", "React", "Vue", "TypeScript", "组件", "工程化"],
  ui: ["UI", "CSS", "设计系统", "交互", "可访问性", "动效"],
  tech: ["AI", "效率", "工作流", "自动化", "工具链", "实践"],
  computer: ["系统", "网络", "性能", "浏览器", "调试", "故障定位"],
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
  tech: [
    "\u591a\u6a21\u578b\u534f\u4f5c\u6b63\u5728\u6539\u53d8\u5f00\u53d1\u6d41\u7a0b\u5417",
    "\u4e2a\u4eba\u77e5\u8bc6\u5e93 + AI\uff0c\u5230\u5e95\u8be5\u600e\u4e48\u642d\u624d\u4e0d\u5403\u7070",
    "\u4ece\u811a\u672c\u5230\u5e73\u53f0\uff1a\u5c0f\u81ea\u52a8\u5316\u9879\u76ee\u5982\u4f55\u6f14\u8fdb",
    "Cursor Rules / AGENTS.md \u6700\u4f73\u5b9e\u8df5\uff1a\u5982\u4f55\u8ba9 AI \u6309\u4f60\u7684\u89c4\u8303\u5199\u4ee3\u7801",
    "\u5411\u91cf\u6570\u636e\u5e93\u9009\u578b\uff1aMilvus / Qdrant / pgvector \u5b9e\u6d4b\u5bf9\u6bd4",
    "GitHub Actions \u8fdb\u9636\uff1a\u77e9\u9635\u6784\u5efa\u3001\u7f13\u5b58\u4e0e\u81ea\u6258\u7ba1 Runner",
    "\u628a LLM \u5d4c\u8fdb\u73b0\u6709\u540e\u7aef\uff1a\u67b6\u6784\u600e\u4e48\u5207\u3001\u8d85\u65f6\u600e\u4e48\u6cbb",
    "Prompt Cache \u548c Context Window \u7ba1\u7406\u7684\u5de5\u7a0b\u5b9e\u8df5",
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
    ideas.push({
      topic: `${core}${tpl.suffix}`,
      reason: `\u6765\u81ea\u4f60\u6700\u8fd1\u6587\u7ae0\u65b9\u5411\uff0c${tpl.reason}`,
      source: "history",
      tags: ["\u5386\u53f2\u504f\u597d", tpl.tag],
      baseScore: tpl.score,
    });
    // Second template for first few seeds only
    if (si < 4) {
      const tpl2 = shuffled[(si * 2 + 1) % shuffled.length];
      if (tpl2 !== tpl) {
        ideas.push({
          topic: `${core}${tpl2.suffix}`,
          reason: `\u6cbf\u7528\u719f\u6089\u4e3b\u9898\uff0c${tpl2.reason}`,
          source: "history",
          tags: ["\u5386\u53f2\u504f\u597d", tpl2.tag],
          baseScore: tpl2.score - 0.02,
        });
      }
    }
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

function buildTemplateCandidates(section: BlogSection | null, rnd: () => number): Candidate[] {
  const sectionTags = section ? new Set(SECTION_TAGS[section]) : null;
  let pool = TEMPLATE_TOPICS.filter(
    (item) => !sectionTags || item.tags.some((t) => sectionTags.has(t)),
  );

  // 综合入口：技术模板占主体，综合类只留少量
  if (!section) {
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

function buildHotCandidates(section: BlogSection | null, rnd: () => number): Candidate[] {
  const seeds = [
    ...(section ? HOT_TOPIC_SEEDS[section] : []),
    ...HOT_TOPIC_SEEDS.all,
  ];
  const shuffledSeeds = [...seeds].sort(() => rnd() - 0.5);
  return shuffledSeeds.map((topic) => ({
    topic,
    reason: TECH_AFFINITY_RE.test(topic)
      ? "工程向热点，适合写成可落地的踩坑或选型文。"
      : "热点向选题，可结合你的写作风格快速开写。",
    source: "hot" as const,
    tags: TECH_AFFINITY_RE.test(topic) ? ["热点", "工程"] : ["热点"],
    baseScore: TECH_AFFINITY_RE.test(topic) ? 0.78 : 0.62,
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

/**
 * 拉取 LLM 生成的当下热点选题。
 * 默认命中 1 小时缓存；`force` 时强制重新调用模型（用于「换一批」）。
 */
async function fetchLlmHotTopics(
  section: BlogSection | null,
  count: number,
  opts?: { force?: boolean; batch?: number },
): Promise<LlmHotTopic[]> {
  const key = section ?? "all";
  const force = Boolean(opts?.force);
  const batch = opts?.batch ?? 0;

  if (!force) {
    const cached = llmHotCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.topics.slice(0, count);
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
      const topics = await generateHotTopics({
        section,
        sectionTags: section ? SECTION_TAGS[section] : DEFAULT_FOCUS_TAGS,
        count: Math.min(10, count + 2),
        batch,
      });
      if (topics.length > 0) {
        llmHotCache.set(key, { expiresAt: Date.now() + LLM_HOT_CACHE_TTL_MS, topics });
        return topics;
      }
      // 强制刷新失败时，尽量回退到旧缓存，避免整页空掉
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
  return llmTopics.map((t) => ({
    topic: t.topic,
    reason: t.angle || "来自 AI 生成的当下热点方向，可结合你的写作风格快速落地。",
    source: "hot" as const,
    tags: t.tags.length > 0 ? ["AI 热点", ...t.tags].slice(0, 4) : ["AI 热点"],
    baseScore: 0.86,
  }));
}

function buildMixedCandidates(
  historyTopics: string[],
  includeHot: boolean,
  rnd: () => number,
): Candidate[] {
  const base = historyTopics.slice(0, 6);
  const allHot = [...HOT_TOPIC_SEEDS.all].sort(() => rnd() - 0.5);
  const out: Candidate[] = [];

  const mixTemplates = [
    (a: string, h: string) => `${a}\u5728\u4eca\u5e74\u65b0\u8d8b\u52bf\u4e0b\uff0c\u5e94\u8be5\u600e\u4e48\u8c03\u6574`,
    (a: string, h: string) => `\u7528\u300c${h.slice(0, 14)}\u300d\u7684\u601d\u8def\u91cd\u65b0\u5ba1\u89c6${a}`,
    (a: string, h: string) => `${a}\u548c${h.slice(0, 12)}\u7684\u4ea4\u53c9\u70b9\u5728\u54ea`,
    (a: string, _h: string) => `\u5982\u679c\u8ba9\u6211\u91cd\u65b0\u505a\u4e00\u6b21${a}`,
    (a: string, _h: string) => `${a}\u7684\u4e0b\u4e00\u6b65\uff1a\u6211\u8ba1\u5212\u600e\u4e48\u8fed\u4ee3`,
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

/**
 * Dedupe + inter-candidate similarity filter + rank.
 * 综合入口偏向技术选题（约 3/4），综合类只占少量席位。
 */
function dedupeAndRank(
  candidates: Candidate[],
  historyTopics: string[],
  count: number,
  seed: number,
): TopicIdea[] {
  const deduped = new Map<string, Candidate>();
  for (const c of candidates) {
    const topic = normalizeTopic(c.topic);
    if (!topic || topic.length < 6) continue;
    const key = topic.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, { ...c, topic });
    }
  }

  const rnd = seededRandom(seed + 99);
  const scored = [...deduped.values()].map((c) => {
    const maxSim = historyTopics.reduce((m, h) => Math.max(m, similarity(c.topic, h)), 0);
    const noveltyBonus = Math.max(0, 0.18 - maxSim * 0.22);
    const jitter = (rnd() - 0.5) * 0.08;
    const affinity = techAffinityBonus(c);
    const score = Math.max(0.25, Math.min(0.99, c.baseScore + noveltyBonus + jitter + affinity));
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

  const generalCap = Math.max(1, Math.floor(count * 0.25));
  const result: TopicIdea[] = [];
  let generalCount = 0;

  for (const item of scored) {
    if (result.length >= count) break;
    const tooSimilar = result.some((r) => similarity(r.topic, item.topic) > 0.45);
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

  // 技术候选不够时再回填，避免列表过短
  if (result.length < count) {
    for (const item of scored) {
      if (result.length >= count) break;
      if (result.some((r) => r.topic === item.topic)) continue;
      const tooSimilar = result.some((r) => similarity(r.topic, item.topic) > 0.45);
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
}) {
  return `${input.userId}|${input.section}|${input.count}|${input.mode}|${input.cursor}`;
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
  const key = makeCacheKey({
    userId: input.userId,
    count,
    mode,
    section: section ?? "all",
    cursor,
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
    const [recent, llmHotTopics] = await Promise.all([
      db.article.findMany({
        where: { userId: input.userId },
        orderBy: { updatedAt: "desc" },
        take: 40,
        select: {
          topic: true,
          title: true,
          keywords: true,
        },
      }),
      includeHot
        ? fetchLlmHotTopics(section, mode === "hot" ? 10 : 6, {
            force: refresh,
            batch: cursor,
          })
        : Promise.resolve([]),
    ]);

    const historyTopics = recent
      .map((a) => (a.title?.trim() || a.topic || "").trim())
      .filter(Boolean)
      .slice(0, 24);

    const seed = seededHash(
      `${input.userId}-${Date.now()}-${cursor}-${mode}-${section ?? "all"}-${refresh ? "r" : "c"}`,
    );
    const rnd = seededRandom(seed);

    const history = buildHistoryCandidates(historyTopics, section, rnd);
    const templates = buildTemplateCandidates(section, rnd);
    const mixed = buildMixedCandidates(historyTopics, includeHot, rnd);
    const llmHot = includeHot ? buildLlmHotCandidates(llmHotTopics) : [];
    const hot = includeHot ? buildHotCandidates(section, rnd) : [];

    let pool: Candidate[] = [];
    let emptyReason: string | null = null;

    if (mode === "history") {
      // 仅历史延伸：不混模板/热点，避免和「热点」看起来一样
      pool = [...history, ...buildMixedCandidates(historyTopics, false, rnd)];
      if (historyTopics.length === 0) {
        emptyReason = "还没有历史文章。先写几篇，或切换到「热点」看看当下选题。";
      } else if (pool.length === 0) {
        emptyReason = "暂时没法从历史文章延伸出选题，试试「综合」或「热点」。";
      }
    } else if (mode === "hot") {
      pool = [...llmHot, ...hot];
      if (pool.length === 0) {
        emptyReason = "热点暂时不可用，请稍后重试或切到「综合」。";
      }
    } else {
      pool = [...llmHot, ...history, ...templates, ...mixed, ...hot];
    }

    const ideas =
      pool.length === 0
        ? []
        : dedupeAndRank(pool, historyTopics, count, seed);

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
