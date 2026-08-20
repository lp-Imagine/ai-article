/**
 * 内容生成 / 大纲生成 / 润色 / 精炼 / 扩写 共用的 prompt block。
 *
 * 每个函数对应一个独立的写作约束「模块」，由上层 prompt 自由组合。
 * 版本：v1.x（从 ai.ts 原始内联版抽取，未变更）。
 * 后续修改请在文件头注释里写明变更点，便于回溯。
 *
 * 这里只放 prompt 字符串 / 纯函数，不放任何 runtime 副作用。
 */
import { getEnvValue } from "@/lib/config-bridge";

export type WritingParams = {
  topic: string;
  style?: string | null;
  audience?: string | null;
  goal?: string | null;
  keywords?: string | null;
  wordCount?: number | null;
};

export function getAccountPersona(): string {
  return getEnvValue("ACCOUNT_PERSONA")?.trim() ?? "";
}

export function parseKeywords(keywords?: string | null): string[] {
  if (!keywords?.trim()) return [];
  return keywords
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildAccountPersonaBlock(): string {
  const persona = getAccountPersona();
  if (!persona) return "";

  return (
    `【账号背景（软约束，不覆盖主题领域）】\n` +
    `${persona}\n` +
    `- 以上只影响叙述口吻、举例偏好和读者关系；**文章写什么仍完全由「主题」决定**\n` +
    `- 若主题与账号主领域不同（如账号偏技术、主题是育儿/理财），按主题领域写，不要硬扯技术\n` +
    `- 若主题与账号领域一致，可自然带入实践细节（代码、工程、Agent 等），但仍需服务主题本身`
  );
}

export function buildDomainAdaptationBlock(): string {
  return (
    `【领域适配（通用，跨行业）】\n` +
    `- **主题决定领域**：写什么由用户输入的主题/关键词决定，不要默认所有文章都是技术文或职场文\n` +
    `- 技术/编程类：以可运行代码、接口约定、边界与踩坑为主；术语用 <code> 标注；少写「意义/趋势」空话\n` +
    `- 产品/商业类：用决策过程、对比选项、具体数字或结果；少堆术语正确但无用的正确废话\n` +
    `- 成长/生活/科普类：用可核对的场景、人物动作、前后对比；道理从事实里长出来，不要先贴标签再硬凑例子\n` +
    `- 判断领域时看主题语义，不看账号名称`
  );
}

/** 从主题/关键词判断是否工程实现向（组件封装、上传、API 等） */
export function isEngineeringTopic(topic: string, keywords?: string | null): boolean {
  const text = `${topic} ${keywords ?? ""}`.toLowerCase();
  const signals = [
    /前端|后端|全栈|工程|封装|组件|hooks?|react|vue|angular|svelte|typescript|javascript|node\.?js/,
    /上传|下载|分片|断点续传|并发|sdk|api|接口|cli|docker|k8s|数据库|sql|redis/,
    /代码|源码|实现|重构|架构|中间件|插件|npm|webpack|vite|bundler|css|html/,
    /component|upload|chunk|resume|typescript|javascript|python|golang|rust|java/,
  ];
  return signals.some((re) => re.test(text));
}

export function buildOnTopicBlock(topic: string, keywords?: string | null): string {
  const kw = parseKeywords(keywords);
  const kwHint = kw.length > 0 ? `关键词（可自然融入，勿生硬堆砌）：${kw.join("、")}` : "无额外关键词";
  return `
【紧扣主题（硬性）】
- 用户主题是写作边界的圆心：「${topic}」。可以在主题内深挖、举例、对比、拆步骤，**禁止跑到无关赛道**
- ${kwHint}
- 允许扩展：同一主题下的前置条件、边界情况、常见误区、可执行下一步——但每段读完应能回答「这和主题有什么关系」
- 禁止借题发挥：不要用主题当引子，后文滑向成功学、行业趋势、空洞励志或账号人设广告
- 若某章节写着写着偏了：删掉偏题部分，回到主题的一个具体问题
`.trim();
}

export function buildEvidenceBlock(engineering: boolean): string {
  if (engineering) {
    return `
【论据与干货（工程向）】
- 凡主张「该怎么做」，必须落到代码、接口字段、状态、命令或可复现步骤之一
- 禁止只有「要注意并发 / 要做好封装」这类正确但无法下手的句子；要么给代码/伪代码，要么给检查清单
- 案例优先写「我当时怎么做的 / 错在哪 / 改完长什么样」，少写「业界普遍认为」
- 事实合规：无可核验来源时，禁止虚构具体人名/公司名、无出处的百分比与日期；可改成匿名角色、区间或量级
- **技术指标除外**：对比/压测语境下的 P50/P90/P99、ms、req/s、吞吐等应保留原样，不要改成「延迟指标」「较短时间」
`.trim();
  }
  return `
【论据与干货（通用）】
- 凡给出建议、判断、方法，至少配一种支撑：具体案例、前后对比、可核对数字、真实场景片段、步骤清单
- 科普/生活/观点文不要求代码；但**不能只有定义和态度**——读者读完要带走能用的东西（怎么判断、怎么试、会踩什么坑）
- 若某章偏实践（教程、操作、避坑）：必须有可跟随步骤或真实情境，禁止纯概念铺陈
- 若某章偏认知（观点、科普）：用一个具体现象/故事钉住论点，再讲机制；不要反过来先空讲大词
- 事实合规：如无法提供可核验来源，不得写具体人名/公司名、无出处的百分比/金额/日期；改为匿名案例与近似表达（如「约三成」「近一周」）
- **技术指标除外**：选型/压测对比里的 P50/P90/P99、ms、req/s 等保留原样
`.trim();
}

export function buildQualityArticleBlock(): string {
  return `
【向优质文章靠拢（写作标准）】
优质公众号/专栏常见共性，请按此自检：
1. **一句主线**：全文只打穿一个核心问题；小节都是主线的分支，不是百科条目拼盘
2. **先问题后展开**：开篇直接点出读者真正卡的问题或核心结论，再展开概念（需要多少讲多少）；不要用虚构闲聊铺垫
3. **信息密度**：删掉后不影响理解的句子一律删；同一意思不换词再说一遍
4. **可感知细节**：时间、数量、报错原文、界面状态、代码行为——比「很重要/很关键」更有说服力
5. **诚实边界**：写清适用条件与做不到的部分；夸大承诺会立刻像营销稿
6. **结尾给带走物**：一个可执行动作、一张检查表、或一个判断标准——不要升华成口号
7. **创作度**：切入角、案例选择、判断要像「为本题现写」，不要像批量模板填空

禁止的空洞写法：
- 只抛概念不下定义也不举例
- 「本质上是认知问题」「关键在于体系化」却不说具体改哪一步
- 排比正确废话、假装深刻的对立（旧时代 vs 新时代）却无事实
- 用「和朋友聊天 / 有人问我 / 上周同事说」这类虚构闲聊当万能开头
- 段段正确但无法下手的「建议」（要重视、要体系化、要持续迭代）
`.trim();
}

/** 对齐微信对低创作度 / 低质 AIGC 的治理口径 */
export function buildWechatPlatformValueBlock(): string {
  return `
【微信公众号内容价值（硬性，平台合规）】
平台会限流「低创作度」内容：高度同质化、搬运抄袭、内容空洞、低质 AIGC。
你必须写出「信息含量高、有阅读价值、有创作度」的稿：

1. **信息增量**：每段至少贡献一件新信息（事实、步骤、判断依据、边界、反例）；删掉后读者应少懂一件事
2. **创作度**：独特切入角 + 可核对判断；禁用「定义→重要性→方法论→注意事项→总结」百科骨架
3. **可核对**：优先可观察细节（场景、数字、报错原文、前后对比）；不写无法证伪的正确废话
4. **反同质化**：开篇、章节顺序、案例选择要服务「这一篇主题」，禁止万能模板换词
5. **反空洞 AIGC**：禁止排比鸡汤、无主体的「我们需要…」、段段正确但无用的建议
6. **诚实**：不确定就标明；不编造数据、论文、权威背书或虚假对话
7. **事实可核验**：没有来源支撑时，禁止写真实人物姓名、具体公司名、无出处的百分比/金额/日期；可用匿名角色+区间（如「某内容团队」「约 20%-30%」）。技术对比表里的 P50/P99、ms、req/s 等指标可保留。

段落自检（任一项为否 → 重写该段）：
- 读者读完能否多知道/会做一件具体事？
- 把主题换成别的标题，这段是否还通顺？（通顺=空泛）
- 是否像随处可见的 AI 水文？（是 → 换成案例/步骤/代码）
- 是否出现了无法核验的具体人物/公司/无出处百分比？（是 → 匿名化并改成区间/量级；技术分位数标签除外）
`.trim();
}

export function buildFactualComplianceBlock(): string {
  return `
【事实与案例（硬性，高于故事感）】
- **禁止无来源编造「人物故事数字」**：不得用张磊/林薇 + 精确百分比假装真实案例
- **技术对比表除外**：吞吐、延迟分位数（P50/P90/P99）、ms、req/s 等指标可保留原样，用于选型对比
- **禁止对话引语**：不得写「他说：「……」」；改为间接叙述（团队提到 / 复盘发现）
- 需要案例时用**匿名场景**，不要用姓名假装真实

错误：「内容团队的张磊把接口升级后，成本涨了 60%。」
正确：「某内容团队升级接口后，平均延迟下降，但尾部延迟恶化，后来回滚并补了评估标准。」
正确（对比表）：用 <table> 列出旧模型 / 新模型 A / 新模型 B 的吞吐与 P50/P99。
`.trim();
}

export function buildEngineeringOutlineBlock(enabled: boolean): string {
  if (!enabled) return "";
  return `
【工程/封装类主题——大纲硬性要求】
- 标题若含「实战 / 手册 / 封装 / 手把手 / 从 0 到 1」，章节必须对应**可交付物**（接口、代码片段、目录结构、边界用例），禁止只有概念章节
- 至少 3 个章节的 summary 要写清「本章会给出什么」：如 Props 设计、分片队列伪代码、错误码表、断点续传时序——不要写「全面介绍XXX」
- 禁止整篇大纲落成：重要性 → 原理 → 方法论 → 注意事项 → 总结（教科书骨架）
- 鼓励差异化骨架（可混用，勿套固定句式）：
  · 先接口后实现（对外 API → 内部状态机 → 边界）
  · 先翻车后正解（真实坑 → 根因 → 最终实现）
  · 最小可用切片（先跑通一条路径，再补并发/续传）
  · 对比选型（原生 / 库 / 自研，各给一段关键代码）
- 章节标题要像工程师笔记：可含具体名词（\`File\`、\`Blob\`、\`concurrent\`、\`etag\`），少用「赋能认知」「底层逻辑」
`.trim();
}

export function buildEngineeringContentBlock(enabled: boolean): string {
  if (!enabled) return "";
  return `
【工程/封装类主题——正文硬性要求】
- **标题承诺必须兑现**：标题/大纲写「实战、手册、封装」，正文必须有可运行或可粘贴的代码；禁止通篇概念与鸡汤
- **代码量**：全文至少 **2** 个 \`<pre><code>\` 代码块（建议 TypeScript/JS）；至少 1 个展示核心 API 或关键流程（≥8 行）
- **少说多写**：用代码、类型定义、调用示例代替「首先要理解…」「本质上是…」长段空论
- 每个涉及实现的 <h2>：先给一段可落地的代码或接口，再用 1-2 段说明「为什么这样写 / 边界」
- 允许省略完整工程脚手架，但关键逻辑（分片、并发池、重试、进度、取消）必须有代码或清晰伪代码
- 禁止用「步骤一/二/三」空壳凑字：每一步都要落到函数名、参数或状态字段
- 若字数与信息密度冲突：**优先信息密度**，宁可略短，也不要注水重复
`.trim();
}

export function buildAntiAiVoiceBlock(): string {
  return `
【去 AI 腔与夸夸其谈（硬性）】
- 禁止套话：在当今/随着…发展/赋能/抓手/闭环/底层逻辑/降维/颗粒度/对齐/沉淀方法论/打造闭环/深度思考/认知升级/众所周知/毋庸置疑/值得注意的是
- 禁止每个大纲都长成：痛点引入 → 三大误解 → 三步方法论 → 注意事项 → 总结（换词不算创新）
- 标题禁止批量套用同一公式；「XXX实战手册」最多在全部方案里出现 1 次，且该方案必须可落地
- 少用抽象形容词（赋能、卓越、全面、系统性）；改用可观察事实
- 允许不完美与取舍：真实感强于完美教条
- **禁止「闲聊代入」开篇模板**：如「周一/上周和一个朋友聊天」「同事问我」「有读者留言说最近在XXX上花了很多时间，进展却不大」——再接「方向对但顺序要调整」这类万能转折
- 禁止段首机械排比（「首先要明白」「其次需要注意」「最后别忘了」连用）；节奏要像人写的笔记
- 同一句式开头不得连续出现 3 次以上
`.trim();
}

export function buildStyleGuide(style: string): string {
  switch (style) {
    case "观点型":
      return (
        `【风格：观点型】\n` +
        `- 开篇亮明核心判断，全文围绕一条主线论证\n` +
        `- 案例和数据服务于论点，不做教程式步骤罗列\n` +
        `- 允许有态度，但每个判断都要有依据`
      );
    case "故事型":
      return (
        `【风格：故事型】\n` +
        `- 用具体经历串联信息，场景描写优先于概念定义\n` +
        `- 道理从故事里自然浮现，避免教科书式「首先/其次/最后」\n` +
        `- 仍要给出读者可带走的一个结论或小行动`
      );
    default:
      return (
        `【风格：干货型】\n` +
        `- 结构清晰，扫读能抓到可执行点\n` +
        `- 步骤、清单、对比、代码优先；概念点到为止\n` +
        `- 每个建议尽量可验证；技术文用接口/代码作证，非技术文用场景/数字作证`
      );
  }
}

export function buildWritingUserPayload(input: WritingParams & { outline?: unknown; outlineCount?: number; sectionsPerOutline?: number }) {
  const style = input.style || "干货型";
  return {
    topic: input.topic,
    style,
    audience: input.audience?.trim() || "公众号读者",
    goal: input.goal?.trim() || "知识分享",
    keywords: parseKeywords(input.keywords),
    wordCount: input.wordCount ?? 1200,
    ...(input.outline !== undefined ? { outline: input.outline } : {}),
    ...(input.outlineCount !== undefined ? { outlineCount: input.outlineCount } : {}),
    ...(input.sectionsPerOutline !== undefined ? { sectionsPerOutline: input.sectionsPerOutline } : {}),
  };
}

/** 正文生成 / 润色共用的微信 HTML 格式规范（违反会导致推送排版错乱） */
export const ARTICLE_HTML_FORMAT_RULES = `
【微信 HTML 格式（硬性）】
文章推送微信公众号，只允许下列结构；禁止 Markdown、inline style、自创 class、figure/img/section。
允许简单对比表：<table><tr><th>…</th></tr><tr><td>…</td></tr></table>（无嵌套、无样式）。

- 正文步骤：<ol><li><strong>标题</strong>说明</li></ol>
- 并列要点：<ul><li><strong>标题</strong>说明</li></ul>
- ⚠️ 禁止列表嵌套（防卡片套卡片）：<ul>/<ol> 的 <li> 里禁止再出现 <ul>/<ol>；需要分层/分组的配置项，一律写成一层 <ul>/<ol>，每项用 <strong>2-8字标题</strong> 区分，绝不在列表里套列表
- ⚠️ 代码块必须是正文顶层的独立块：<pre><code class="language-真实语言">…</code></pre>，语言与内容匹配（python/javascript/typescript/bash/shell/sql/json/html/css 等，终端命令用 bash/shell）；禁止把 <pre>/<code> 放进 <li>、mp-tip、mp-warning、mp-summary、blockquote 等任何列表/卡片容器内；列表项和卡片里只写文字说明，不写代码；有代码的内容直接用独立代码块，不要同时用列表/卡片格式包裹；代码示例前用「示例：」或「配置如下：」等引导文字开头引出，让代码块归属清晰
- mp-tip：div 内只能有单个 <ol>，li 结构与正文 ol 完全相同；禁止 ul、多个 p、嵌套 li、嵌套列表、写「实用技巧」等标题
- mp-warning：div 内只用 <p>...</p>；禁止列表和「注意」标题
- 总结：<h2>总结</h2> + <div class="mp-summary"><p>...</p></div>
- 引用：<blockquote><p>...</p></blockquote>

列表项统一写法：<li><strong>2-8字标题</strong>说明正文</li>（标题与说明同一行，不用 br，li 内不用 p，li 内绝不出现 <pre>/<code>/<ul>/<ol>）
`.trim();

/** 润色 / 扩写用的精简版，避免占用过多上下文 */
export const ARTICLE_HTML_FORMAT_RULES_BRIEF = `
【HTML 格式】保留现有结构；⚠️ 禁止列表嵌套（li 内禁止再出现 ul/ol，防卡片套卡片）；代码块用 <pre><code class="language-真实语言">…</code></pre> 且必须是正文顶层的独立块，禁止放进 li/卡片容器内，列表项和卡片里只写文字、不写代码，代码示例前用「示例：」/「配置如下：」等引导文字引出；mp-tip 内仅单个 <ol>；mp-warning/mp-summary 内仅 <p>；列表项用 <li><strong>标题</strong>说明</li>；允许简单对比 <table>；禁止新增 figure/img/section/自创 class；处理整篇稿时保留结尾 <h2>总结</h2> + <div class="mp-summary"><p>…</p></div> 卡片，若缺失则在文末补一段概括全文核心判断与可带走结论的总结（mp-summary 内仅 <p>，禁止列表/口号）。
`.trim();
