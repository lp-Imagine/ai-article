import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, withAuthUserConfig } from "@/lib/api-auth";
import { convertImportedContent, ImportContentError } from "@/lib/import-content";
import { getEnvValue } from "@/lib/config-bridge";
import {
  enqueueGenerationJob,
  JobLimitError,
} from "@/lib/jobs/enqueue";

const importArticleSchema = z.object({
  title: z.string().trim().min(1, "请输入标题").max(200, "标题过长"),
  /** Raw text, or base64 when contentEncoding is "base64" (avoids BaoTa WAF false positives). */
  content: z.string().min(1, "请粘贴正文内容"),
  contentEncoding: z.enum(["plain", "base64"]).optional().default("plain"),
  summary: z.string().trim().max(500).optional().nullable(),
  /** 默认导入后自动排队「整理格式」 */
  autoReformat: z.boolean().optional().default(true),
});

function decodeImportContent(content: string, encoding: "plain" | "base64"): string {
  if (encoding !== "base64") return content;
  try {
    return Buffer.from(content, "base64").toString("utf8");
  } catch {
    throw new ImportContentError("正文解码失败，请重试");
  }
}

function isAiReady() {
  return Boolean(getEnvValue("AI_API_KEY"));
}

/** 导入手写文章（独立路由，避免与创建/批量删除共用时被网关误伤） */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user instanceof NextResponse) return user;

    return withAuthUserConfig(user, async () => {
      const json = await request.json().catch(() => null);
      if (!json || typeof json !== "object") {
        return NextResponse.json(
          { code: 1000, message: "请求体无效", data: null },
          { status: 400 },
        );
      }

      const input = importArticleSchema.parse(json);
      const rawContent = decodeImportContent(input.content, input.contentEncoding);
      const { html, wordCount } = convertImportedContent(rawContent);
      const summary = input.summary?.trim() || null;

      const article = await db.article.create({
        data: {
          userId: user.id,
          topic: input.title,
          title: input.title,
          content: html,
          summary,
          status: "edited",
          wordCount,
          outlineCount: 3,
        },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
        },
      });

      let jobId: string | null = null;
      let reformatSkippedReason: string | null = null;

      if (input.autoReformat) {
        if (!isAiReady()) {
          reformatSkippedReason =
            "未配置 AI API Key，已跳过自动整理格式。请到「设置 → AI 模型」填写后重试导入，或在编辑页手动点「整理格式」。";
        } else {
          try {
            const job = await enqueueGenerationJob({
              user,
              articleId: article.id,
              type: "polish",
              payload: { mode: "reformat" },
            });
            jobId = job.id;
          } catch (error) {
            if (error instanceof JobLimitError) {
              reformatSkippedReason = error.message;
            } else {
              throw error;
            }
          }
        }
      }

      return NextResponse.json({
        code: 0,
        message: jobId ? "已导入，正在整理格式" : "ok",
        data: {
          ...article,
          jobId,
          reformatQueued: Boolean(jobId),
          reformatSkippedReason,
        },
      });
    });
  } catch (error) {
    if (error instanceof NextResponse) return error;
    const message =
      error instanceof ImportContentError
        ? error.message
        : error instanceof z.ZodError
          ? error.issues[0]?.message || "参数错误"
          : error instanceof Error
            ? error.message
            : "导入文章失败";
    const isConfigError =
      /DATABASE_URL|PostgreSQL|SQLite|Prisma Client/i.test(message);
    return NextResponse.json(
      {
        code: 1000,
        message,
        data: null,
      },
      { status: isConfigError ? 500 : 400 },
    );
  }
}
