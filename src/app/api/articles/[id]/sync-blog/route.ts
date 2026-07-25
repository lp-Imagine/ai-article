import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { findOwnedArticle, requireUser, withAuthUserConfig } from "@/lib/api-auth";
import { isBlogSyncConfigured, syncArticleToBlog } from "@/lib/blog-sync";
import {
  BLOG_SECTIONS,
  isValidBlogGroup,
  type BlogSection,
} from "@/lib/blog-sync-constants";

const bodySchema = z.object({
  section: z.enum(BLOG_SECTIONS),
  group: z.string().trim().min(1).max(40).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  draft: z.boolean().optional(),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  return withAuthUserConfig(user, async () => {
    if (!isBlogSyncConfigured()) {
      return NextResponse.json(
        {
          code: 1004,
          message:
            "尚未配置博客同步。请在 /settings「博客同步」中填写 GitHub Token（需 contents:write + actions:write）。",
          data: null,
        },
        { status: 400 },
      );
    }

    const article = await findOwnedArticle(id, user.id);
    if (!article) {
      return NextResponse.json(
        { code: 404, message: "article not found", data: null },
        { status: 404 },
      );
    }

    if (!article.content?.trim()) {
      return NextResponse.json(
        { code: 1002, message: "正文为空，无法同步到博客", data: null },
        { status: 400 },
      );
    }

    if (!(article.title ?? article.topic)?.trim()) {
      return NextResponse.json(
        { code: 1002, message: "标题为空，无法同步到博客", data: null },
        { status: 400 },
      );
    }

    let parsed: z.infer<typeof bodySchema>;
    try {
      const json = await req.json();
      parsed = bodySchema.parse(json);
    } catch (err) {
      const message =
        err instanceof z.ZodError
          ? err.issues.map((i) => i.message).join("; ")
          : "请求参数无效，请选择栏目 section";
      return NextResponse.json(
        { code: 1001, message, data: null },
        { status: 400 },
      );
    }

    if (
      parsed.group &&
      !isValidBlogGroup(parsed.section as BlogSection, parsed.group)
    ) {
      return NextResponse.json(
        {
          code: 1001,
          message: `栏目 ${parsed.section} 下不支持分组 ${parsed.group}`,
          data: null,
        },
        { status: 400 },
      );
    }

    try {
      const result = await syncArticleToBlog(
        {
          id: article.id,
          title: article.title,
          topic: article.topic,
          summary: article.summary,
          content: article.content,
          coverImageUrl: article.coverImageUrl,
          keywords: article.keywords,
          createdAt: article.createdAt,
        },
        {
          section: parsed.section as BlogSection,
          group: parsed.group,
          tags: parsed.tags,
          draft: parsed.draft,
        },
      );

      await db.publishRecord.create({
        data: {
          articleId: id,
          channel: "blog",
          status: "success",
          requestPayload: JSON.stringify({
            section: parsed.section,
            group: parsed.group,
            tags: parsed.tags ?? [],
            draft: parsed.draft === true,
          }),
          responsePayload: JSON.stringify(result),
        },
      });

      return NextResponse.json({
        code: 0,
        message: "ok",
        data: result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步到博客失败";
      await db.publishRecord.create({
        data: {
          articleId: id,
          channel: "blog",
          status: "failed",
          errorMessage: message,
          requestPayload: JSON.stringify({
            section: parsed.section,
            tags: parsed.tags ?? [],
          }),
        },
      });
      return NextResponse.json(
        { code: 1502, message, data: null },
        { status: 500 },
      );
    }
  });
}
