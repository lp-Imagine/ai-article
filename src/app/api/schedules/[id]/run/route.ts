import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";
import { withAuthUserConfig } from "@/lib/api-auth";
import { enqueueGenerationJob } from "@/lib/jobs/enqueue";
import { getTopicIdeas } from "@/lib/topic-ideas";

/** 手动立即执行一次定时任务（不影响原有调度计划） */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  const schedule = await db.articleSchedule.findFirst({
    where: { id, userId: user.id },
  });
  if (!schedule) {
    return NextResponse.json(
      { code: 1004, message: "定时任务不存在", data: null },
      { status: 404 },
    );
  }

  return withAuthUserConfig(user, async () => {
    try {
      let topic = schedule.fixedTopic?.trim() ?? "";
      if (schedule.topicSource === "ideas") {
        try {
          const result = await getTopicIdeas({
            userId: user.id,
            count: 5,
            includeHot: true,
            cursor: schedule.runCount,
          });
          topic = result.ideas[0]?.topic ?? topic;
        } catch {
          // 灵感不可用时回退固定主题
        }
      }
      if (!topic) {
        return NextResponse.json(
          { code: 1000, message: "未配置主题，无法执行", data: null },
          { status: 400 },
        );
      }

      const article = await db.article.create({
        data: {
          userId: user.id,
          topic,
          keywords: schedule.keywords,
          style: schedule.style,
          wordCount: schedule.wordCount,
          audience: schedule.audience,
          goal: schedule.goal,
          outlineCount: 3,
        },
      });

      const job = await enqueueGenerationJob({
        user,
        articleId: article.id,
        type: "quick_generate",
        payload: { autoPush: schedule.autoPush },
      });

      const now = new Date();
      await db.articleSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: now,
          runCount: { increment: 1 },
          lastArticleId: article.id,
          lastError: null,
        },
      });

      return NextResponse.json({
        code: 0,
        message: "ok",
        data: { article, job },
      });
    } catch (error) {
      return NextResponse.json(
        {
          code: 1000,
          message: error instanceof Error ? error.message : "执行失败",
          data: null,
        },
        { status: 400 },
      );
    }
  });
}
