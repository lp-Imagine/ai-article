import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser, withAuthUserConfig } from "@/lib/api-auth";
import { PushDraftError, pushArticleToWechatDraft } from "@/lib/push-draft";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  return withAuthUserConfig(user, async () => {
    try {
      const result = await pushArticleToWechatDraft({
        articleId: id,
        userId: user.id,
      });

      return NextResponse.json({
        code: 0,
        message: "ok",
        data: {
          wechatDraftId: result.draftMediaId,
          status: "pushed",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "推送失败";
      const code = error instanceof PushDraftError ? error.code : 1501;

      // 业务校验类错误（文章不存在/正文为空/未配置微信）按原行为返回对应状态码
      if (error instanceof PushDraftError && error.code !== 1501) {
        return NextResponse.json(
          { code: error.code, message, data: null },
          { status: error.code === 404 ? 404 : 400 },
        );
      }

      // 执行期失败：记录 publishRecord + 更新文章状态（与原行为一致）
      await db.publishRecord.create({
        data: {
          articleId: id,
          channel: "wechat",
          status: "failed",
          errorMessage: message,
        },
      });
      await db.article.update({
        where: { id },
        data: { status: "failed" },
      });
      return NextResponse.json(
        { code: 1501, message, data: null },
        { status: 500 }
      );
    }
  });
}
