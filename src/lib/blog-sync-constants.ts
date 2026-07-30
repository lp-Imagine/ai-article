export const BLOG_SECTIONS = ["web", "ui", "tech", "computer", "agent", "misc"] as const;
export type BlogSection = (typeof BLOG_SECTIONS)[number];

export type BlogGroupOption = { id: string; label: string };

/** 与 penn-notes / vuepressblog 侧栏分组对齐 */
export const SECTION_GROUPS: Record<BlogSection, BlogGroupOption[]> = {
  web: [
    { id: "javascript", label: "JavaScript" },
    { id: "vue", label: "Vue" },
    { id: "react", label: "React" },
    { id: "ui-lib", label: "UI 组件" },
    { id: "misc", label: "其它" },
  ],
  ui: [
    { id: "html", label: "HTML" },
    { id: "css", label: "CSS" },
    { id: "misc", label: "其它" },
  ],
  tech: [
    { id: "docs", label: "常用文档" },
    { id: "github", label: "GitHub" },
    { id: "nodejs", label: "Node.js" },
    { id: "bookmarks", label: "资源收藏" },
    { id: "misc", label: "其它" },
  ],
  computer: [
    { id: "browser", label: "浏览器" },
    { id: "misc", label: "其它" },
  ],
  agent: [
    { id: "practice", label: "实战" },
    { id: "workflow", label: "工作流" },
    { id: "prompts", label: "提示词" },
    { id: "tools", label: "工具链" },
    { id: "misc", label: "其它" },
  ],
  misc: [
    { id: "essays", label: "随笔" },
    { id: "career", label: "职场" },
    { id: "life", label: "生活" },
    { id: "method", label: "方法论" },
    { id: "misc", label: "其它" },
  ],
};

/** 栏目打分：命中即加权，取最高分 */
const SECTION_HINTS: Array<{ section: BlogSection; re: RegExp; weight: number }> = [
  // AI Agent / 模型
  {
    section: "agent",
    re: /agent|claude\s*code|cursor|codex|mcp|llm|gpt|opus|sonnet|提示词|prompt|模型|token|rag|embedding|多智能体|工作流|ai\s*编码|大模型|openai|anthropic|deepseek|qwen|kimi/i,
    weight: 6,
  },
  {
    section: "agent",
    re: /选型|基准|benchmark|slo|推理|上下文|context\s*window|api\s*价格|调用成本/i,
    weight: 3,
  },
  // 浏览器
  {
    section: "computer",
    re: /浏览器|chrome|chromium|extension|扩展|devtools|渲染引擎|v8|webkit/i,
    weight: 6,
  },
  // 样式
  {
    section: "ui",
    re: /\bcss\b|scss|less|tailwind|flex|grid|布局|样式|动画|html5|\bhtml\b|响应式|视觉/i,
    weight: 5,
  },
  // 工具备忘
  {
    section: "tech",
    re: /\bgit\b|github|npm|pnpm|yarn|node\.?js|mysql|sql|yaml|markdown|docker|linux|命令行|备忘|文档|收藏/i,
    weight: 5,
  },
  // JS & 框架
  {
    section: "web",
    re: /javascript|typescript|\bjs\b|\bts\b|vue|react|next\.?js|nuxt|webpack|vite|es6|promise|async|前端框架|组件库|element|antd/i,
    weight: 5,
  },
  // 杂项
  {
    section: "misc",
    re: /职场|随笔|生活|方法论|成长|读书|感想|复盘/i,
    weight: 4,
  },
];

const TAG_TO_GROUP: Array<{ re: RegExp; group: string }> = [
  { re: /vue|nuxt/i, group: "vue" },
  { re: /react|next\.?js/i, group: "react" },
  { re: /element|antd|ui\s*组件|组件库/i, group: "ui-lib" },
  { re: /javascript|typescript|\bjs\b|\bts\b|promise|es6|async/i, group: "javascript" },
  { re: /\bcss\b|flex|grid|布局|样式|tailwind|scss/i, group: "css" },
  { re: /\bhtml\b/i, group: "html" },
  { re: /git(?!hub)|npm|mysql|yaml|markdown|命令|docker|linux/i, group: "docs" },
  { re: /github/i, group: "github" },
  { re: /node/i, group: "nodejs" },
  { re: /浏览器|chrome|extension|扩展/i, group: "browser" },
  { re: /提示词|prompt/i, group: "prompts" },
  { re: /工作流|workflow|pipeline|编排/i, group: "workflow" },
  { re: /mcp|工具链|cursor|claude\s*code|codex|ide|sdk/i, group: "tools" },
  { re: /agent|模型|llm|gpt|选型|benchmark|实战|案例/i, group: "practice" },
  { re: /职场|面试|晋升/i, group: "career" },
  { re: /生活|旅行|日常/i, group: "life" },
  { re: /方法论|效率|习惯|复盘/i, group: "method" },
  { re: /随笔|感想|读书/i, group: "essays" },
];

export function inferBlogSection(hints: string[]): BlogSection {
  const blob = hints.filter(Boolean).join(" ");
  if (!blob.trim()) return "web";

  const scores = new Map<BlogSection, number>();
  for (const { section, re, weight } of SECTION_HINTS) {
    if (!re.test(blob)) continue;
    scores.set(section, (scores.get(section) ?? 0) + weight);
  }

  let best: BlogSection = "web";
  let bestScore = 0;
  for (const [section, score] of scores) {
    if (score > bestScore) {
      best = section;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : "web";
}

export function inferBlogGroup(section: BlogSection, hints: string[]): string {
  const groups = SECTION_GROUPS[section] ?? SECTION_GROUPS.misc;
  const allowed = new Set(groups.map((g) => g.id));
  const blob = hints.filter(Boolean).join(" ");
  for (const { re, group } of TAG_TO_GROUP) {
    if (re.test(blob) && allowed.has(group)) return group;
  }
  return groups[0]?.id ?? "misc";
}

/** 根据标题/摘要/标签等自动推断栏目 + 侧栏分组 */
export function inferBlogPlacement(hints: string[]): {
  section: BlogSection;
  group: string;
} {
  const section = inferBlogSection(hints);
  const group = inferBlogGroup(section, hints);
  return { section, group };
}

export function isValidBlogGroup(section: BlogSection, group: string): boolean {
  return (SECTION_GROUPS[section] ?? []).some((g) => g.id === group);
}
