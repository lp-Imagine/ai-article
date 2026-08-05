import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";
import { computeNextRunAt } from "@/lib/scheduler";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  topicSource: z.enum(["fixed", "ideas"]).optional(),
  fixedTopic: z.string().trim().max(200).nullable().optional(),
  keywords: z.string().max(200).nullable().optional(),
  style: z.string().max(50).nullable().optional(),
  wordCount: z.number().int().min(300).max(5000).nullable().optional(),
  audience: z.string().max(100).nullable().optional(),
  goal: z.string().max(100).nullable().optional(),
  autoPush: z.boolean().optional(),
  scheduleType: z.enum(["daily", "weekly", "interval_hours"]).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  minute: z.number().int().min(0).max(59).optional(),
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  intervalHours: z.number().int().min(1).max(168).nullable().optional(),
  enabled: z.boolean().optional(),
});

async function findOwnedSchedule(id: string, userId: string) {
  return db.articleSchedule.findFirst({ where: { id, userId } });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  const schedule = await findOwnedSchedule(id, user.id);
  if (!schedule) {
    return NextResponse.json(
      { code: 1004, message: "定时任务不存在", data: null },
      { status: 404 },
    );
  }
  return NextResponse.json({ code: 0, message: "ok", data: schedule });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  const existing = await findOwnedSchedule(id, user.id);
  if (!existing) {
    return NextResponse.json(
      { code: 1004, message: "定时任务不存在", data: null },
      { status: 404 },
    );
  }

  try {
    const input = updateSchema.parse(await request.json());
    const merged = { ...existing, ...input };

    // 调度相关字段变化或启用状态变化时，重算 nextRunAt
    const scheduleChanged =
      input.scheduleType !== undefined ||
      input.hour !== undefined ||
      input.minute !== undefined ||
      input.weekday !== undefined ||
      input.intervalHours !== undefined;
    const enabledChanged = input.enabled !== undefined;

    let nextRunAt = existing.nextRunAt;
    if (merged.enabled) {
      if (scheduleChanged || enabledChanged || !nextRunAt) {
        nextRunAt = computeNextRunAt(merged);
      }
    } else {
      nextRunAt = null;
    }

    const schedule = await db.articleSchedule.update({
      where: { id: existing.id },
      data: {
        ...input,
        nextRunAt,
      },
    });

    return NextResponse.json({ code: 0, message: "ok", data: schedule });
  } catch (error) {
    return NextResponse.json(
      {
        code: 1000,
        message: error instanceof Error ? error.message : "更新定时任务失败",
        data: null,
      },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  const existing = await findOwnedSchedule(id, user.id);
  if (!existing) {
    return NextResponse.json(
      { code: 1004, message: "定时任务不存在", data: null },
      { status: 404 },
    );
  }

  await db.articleSchedule.delete({ where: { id: existing.id } });
  return NextResponse.json({ code: 0, message: "ok", data: { deleted: true } });
}
