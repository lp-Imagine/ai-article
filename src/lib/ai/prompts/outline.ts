/**
 * 大纲生成 prompt：buildOutlinePrompt + OutlinePromptInput 类型。
 *
 * 版本：v2.0.0（用论证路径和交付物区分方案）。
 */
import type { ChatMessage } from "@/lib/ai/types";
import {
  buildAccountPersonaBlock,
  buildDomainAdaptationBlock,
  buildOnTopicBlock,
  buildStyleGuide,
  buildWritingUserPayload,
} from "@/lib/ai/prompts/common";

export const OUTLINE_PROMPT_VERSION = "2.0.0";

export type OutlinePromptInput = {
  topic: string;
  style: string;
  audience: string;
  wordCount: number;
  goal?: string | null;
  keywords?: string | null;
  count: number;
  sectionCount: number;
  engineering: boolean;
  /** 非空时表示本次只生成一套方案，并锁定该切入角 */
  angle: string | null;
};

export function buildOutlinePrompt(input: OutlinePromptInput): ChatMessage[] {
  const { topic, style, audience, wordCount, count, sectionCount, engineering, angle } = input;
  const single = angle !== null;

  return [
    {
      role: "system",
      content: `你是公众号与博客专栏主编。${
        single
          ? "生成 1 个可直接进入写作的大纲，并严格采用指定切入角。"
          : `生成 ${count} 个论证路径真正不同的大纲，不是同一目录换标题。`
      }

${buildDomainAdaptationBlock()}

${buildAccountPersonaBlock()}

${buildOnTopicBlock(input.topic, input.keywords)}

【1. 选题任务】
${
  single
    ? `- 指定切入角：${angle}\n- 切入角必须改变标题、章节顺序、论证路径和结尾交付物`
    : "- 各方案分别解决不同的读者冲突，并使用不同的论证顺序与最终交付物"
}
- 必须服务同一主题「${topic}」，差异在切入角与论证路径，不在换赛道
- 目标读者：${audience}，写作风格：${style}，文章目标：${input.goal?.trim() || "知识分享"}，目标字数：约 ${wordCount} 字
- positioning 用 15-30 字写清本篇独特判断、适合谁和最终交付物

${buildStyleGuide(style)}

【2. 章节合同】
- 每个大纲约 ${sectionCount} 章；每章只承担一个不可被其他章替代的贡献
- summary 明确该章新增的证据和交付物，例如对比表、决策标准、代码、步骤、失败案例或边界清单
- ${engineering ? "工程主题至少一半章节交付接口、代码、状态、命令或测试边界。" : "非工程主题至少一半章节交付场景、步骤、反例、对比或判断标准。"}
- 标题不超过 20 字，并兑现正文内容；各方案标题句式也要不同

【3. 短禁用表】
- 不写「什么是、为什么重要、方法论、注意事项、总结与展望」百科目录
- 不编造人物、公司、数据、日期和对话，不使用标题党或空喊「实战手册」

【输出格式】
${
  single
    ? "- outlines 数组长度必须为 1"
    : `- **必须恰好返回 ${count} 个大纲**（outlines 数组长度 = ${count}），少一个都不合格；禁止只给 2～3 个就收工`
}
- JSON：{ "outlines": [ { "title", "positioning", "sections": [ { "heading", "summary" } ] } ] }`,
    },
    {
      role: "user",
      content: JSON.stringify({
        ...buildWritingUserPayload({
          topic,
          style,
          wordCount,
          audience,
          goal: input.goal,
          keywords: input.keywords,
          outlineCount: single ? 1 : count,
          sectionsPerOutline: sectionCount,
        }),
        contentMode: engineering ? "engineering-hands-on" : "general",
        mustIncludeCodeInArticle: engineering,
        requiredOutlineCount: single ? 1 : count,
        ...(single ? { requiredAngle: angle } : {}),
      }),
    },
  ];
}
