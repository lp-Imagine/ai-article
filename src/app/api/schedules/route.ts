import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";
import { computeNextRunAt, ensureSchedulerStarted } from "@/lib/scheduler";

const scheduleSchema = z.object({
  name: z.string().trim().min(1, "请输入任务名称").max(50),
  topicSource: z.enum(["fixed", "ideas"]).default("fixed"),
  fixedTopic: z.string().trim().max(200).optional(),
  keywords: z.string().max(200).optional(),
  style: z.string().max(50).optional(),
  wordCount: z.number().int().min(300).max(5000).optional(),
  audience: z.string().max(100).optional(),
  goal: z.string().max(100).optional(),
  autoPush: z.boolean().default(false),
  scheduleType: z.enum(["daily", "weekly", "interval_hours"]).default("daily"),
  hour: z.number().int().min(0).max(23).default(9),
  minute: z.number().int().min(0).max(59).default(0),
  weekday: z.number().int().min(0).max(6).optional(),
  intervalHours: z.number().int().min(1).max(168).optional(),
  enabled: z.boolean().default(true),
});

function validateSchedule(input: z.infer<typeof scheduleSchema>): string | null {
  if (input.topicSource === "fixed" && !input.fixedTopic?.trim()) {
    return "固定主题模式需要填写主题";
  }
  if (input.scheduleType === "weekly" && typeof input.weekday !== "number") {
    return "每周模式需要选择星期几";
  }
  if (input.scheduleType === "interval_hours" && !input.intervalHours) {
    return "间隔模式需要填写间隔小时数";
  }
  return null;
}

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  // 兜底：首次访问定时任务页面时确保调度器已启动（instrumentation 之外的保险）
  ensureSchedulerStarted();

  const schedules = await db.articleSchedule.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ code: 0, message: "ok", data: schedules });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  try {
    const input = scheduleSchema.parse(await request.json());
    const validationError = validateSchedule(input);
    if (validationError) {
      return NextResponse.json(
        { code: 1000, message: validationError, data: null },
        { status: 400 },
      );
    }

    const schedule = await db.articleSchedule.create({
      data: {
        userId: user.id,
        ...input,
        fixedTopic: input.fixedTopic || null,
        nextRunAt: input.enabled
          ? computeNextRunAt({
              ...input,
              weekday: input.weekday ?? null,
              intervalHours: input.intervalHours ?? null,
            })
          : null,
      },
    });

    return NextResponse.json({ code: 0, message: "ok", data: schedule });
  } catch (error) {
    return NextResponse.json(
      {
        code: 1000,
        message: error instanceof Error ? error.message : "创建定时任务失败",
        data: null,
      },
      { status: 400 },
    );
  }
}
