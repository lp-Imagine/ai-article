import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const SENSITIVE_WORDS = ["最", "第一", "绝对", "100%", "包过", "稳赚", "唯一"];

function findIssues(content: string) {
  const issues: string[] = [];
  for (const word of SENSITIVE_WORDS) {
    if (content.includes(word)) {
      issues.push(`包含敏感词：${word}`);
    }
  }
  const longParagraphs = content
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 400);

  if (longParagraphs.length > 0) {
    issues.push(`有 ${longParagraphs.length} 段长度过长，可拆分`);
  }

  return issues;
}

function buildSuggestions(issues: string[]) {
  const suggestions: string[] = [];
  if (issues.some((i) => i.startsWith("包含敏感词"))) {
    suggestions.push("将绝对化词汇替换为更具体、可验证的描述");
  }
  if (issues.some((i) => i.includes("长度过长"))) {
    suggestions.push("把过长段落拆分为 2 段以上");
  }
  if (issues.length === 0) {
    suggestions.push("当前内容未发现明显风险");
  }
  return suggestions;
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const article = await db.article.findUnique({
    where: { id },
  });

  if (!article) {
    return NextResponse.json(
      { code: 404, message: "article not found", data: null },
      { status: 404 }
    );
  }

  const content = `${article.title ?? ""}\n${article.summary ?? ""}\n${article.content ?? ""}`;

  const issues = findIssues(content);
  const score = Math.max(40, 100 - issues.length * 10);
  const suggestions = buildSuggestions(issues);

  await db.riskCheck.create({
    data: {
      articleId: id,
      score,
      issues: JSON.stringify(issues),
      suggestions: JSON.stringify(suggestions),
    },
  });

  await db.article.update({
    where: { id },
    data: { status: "checked" },
  });

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: {
      score,
      issues,
      suggestions,
    },
  });
}