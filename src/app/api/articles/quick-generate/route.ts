import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";
import {
  enqueueGenerationJob,
  jobAcceptedResponse,
  jobLimitErrorResponse,
} from "@/lib/jobs/enqueue";

const quickGenerateSchema = z.object({
  topic: z.string().trim().min(1, "请输入主题").max(200),
  keywords: z.string().max(200).optional(),
  style: z.string().max(50).optional(),
  wordCount: z.number().int().min(300).max(5000).optional(),
  audience: z.string().max(100).optional(),
  goal: z.string().max(100).optional(),
  outlineCount: z.number().int().min(2).max(6).optional(),
  autoPush: z.boolean().optional(),
  autoPushBlog: z.boolean().optional(),
});

/**
 * 快捷生成文章：一键完成 大纲 → 自动采用第 1 套 → 正文（含精炼 + 封面）
 * →（可选）自动推送微信草稿，全程无需用户中途干预。
 */
export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  try {
    const input = quickGenerateSchema.parse(await request.json());

    const article = await db.article.create({
      data: {
        userId: user.id,
        topic: input.topic,
        keywords: input.keywords,
        style: input.style,
        wordCount: input.wordCount,
        audience: input.audience,
        goal: input.goal,
        outlineCount: input.outlineCount ?? 3,
      },
    });

    const job = await enqueueGenerationJob({
      user,
      articleId: article.id,
      type: "quick_generate",
      payload: {
        autoPush: input.autoPush === true,
        autoPushBlog: input.autoPushBlog === true,
      },
    });

    const response = jobAcceptedResponse(job, "快捷生成任务已排队");
    const json = await response.json();
    json.data = { ...(json.data ?? {}), article };
    return NextResponse.json(json, { status: response.status });
  } catch (error) {
    const limitResponse = jobLimitErrorResponse(error);
    if (limitResponse) return limitResponse;
    return NextResponse.json(
      {
        code: 1000,
        message:
          error instanceof Error ? error.message : "创建快捷生成任务失败",
        data: null,
      },
      { status: 400 },
    );
  }
}
