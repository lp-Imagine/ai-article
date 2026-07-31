import { NextResponse } from "next/server";
import { requireUser, withAuthUserConfig } from "@/lib/api-auth";
import { getTopicIdeas } from "@/lib/topic-ideas";

/** Simple in-memory click metrics (not persisted, resets on restart) */
const metrics = { served: 0, clicked: 0 };

export async function GET(request: Request) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const { searchParams } = new URL(request.url);
  const count = Number(searchParams.get("count") ?? "8") || 8;
  const section = searchParams.get("section") || undefined;
  const includeHot = searchParams.get("includeHot") !== "false";
  const cursor = Number(searchParams.get("cursor") ?? "0") || 0;

  // 注入用户级 AI 配置（设置页保存的 key），否则 LLM 热点生成读不到 key 只能降级
  return withAuthUserConfig(user, async () => {
    try {
      const result = await getTopicIdeas({
        userId: user.id,
        count,
        section: section as Parameters<typeof getTopicIdeas>[0]["section"],
        includeHot,
        cursor,
      });
      metrics.served += result.ideas.length;
      return NextResponse.json({
        code: 0,
        message: "ok",
        data: result,
      });
    } catch (error) {
      console.error("[topic-ideas] failed:", error);
      return NextResponse.json(
        {
          code: 1000,
          message: error instanceof Error ? error.message : "获取选题建议失败",
          data: null,
        },
        { status: 500 },
      );
    }
  });
}

/** Record that a suggestion was clicked (fire-and-forget from client) */
export async function POST(request: Request) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  try {
    const body = await request.json().catch(() => ({}));
    const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
    if (topic) {
      metrics.clicked += 1;
      console.log(`[topic-ideas] click userId=${user.id} topic="${topic.slice(0, 40)}"`);
    }
    return NextResponse.json({ code: 0, message: "ok", data: { metrics } });
  } catch {
    return NextResponse.json({ code: 0, message: "ok", data: null });
  }
}
