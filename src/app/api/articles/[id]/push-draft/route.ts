import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { downloadToBuffer, generateCoverImage } from "@/lib/image-gen";
import { isReady as isWechatReady, getAccessToken, uploadMedia, buildWechatDigest } from "@/lib/wechat";
import { convertToWechatHtml, prependWechatDigest } from "@/lib/wechat-style";
import { findOwnedArticle, requireUser, withAuthUserConfig } from "@/lib/api-auth";

/** 上传图片到微信素材库，返回可用于草稿正文的 url */
async function uploadInlineImage(
  accessToken: string,
  imageUrl: string,
): Promise<string> {
  const buffer = await downloadToBuffer(imageUrl);
  if (!buffer) {
    throw new Error(`下载图片失败: ${imageUrl}`);
  }
  // 使用 permanent material 接口（material/add_material），图片会返回 url
  const url = new URL("https://api.weixin.qq.com/cgi-bin/material/add_material");
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("type", "image");

  const form = new FormData();
  const bytes = new Uint8Array(buffer);
  form.append("media", new Blob([bytes], { type: "image/jpeg" }), "image.jpg");

  const res = await fetch(url.toString(), {
    method: "POST",
    body: form,
  });
  const json = (await res.json()) as {
    media_id?: string;
    url?: string;
    errcode?: number;
    errmsg?: string;
  };

  if (!json.url) {
    throw new Error(`微信图片上传失败: ${json.errmsg ?? "unknown"}`);
  }
  return json.url;
}

/** 将正文中所有 <img src="..."> 的图片上传到微信并替换 URL */
async function replaceInlineImages(
  content: string,
  token: string,
): Promise<string> {
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const matches = [...content.matchAll(imgRegex)];

  if (matches.length === 0) return content;

  let result = content;
  for (const match of matches) {
    const originalSrc = match[1];
    // 跳过已经是微信域名的图片
    if (originalSrc.includes("mmbiz.qpic.cn") || originalSrc.includes("mp.weixin.qq.com")) {
      continue;
    }
    try {
      const wechatUrl = await uploadInlineImage(token, originalSrc);
      result = result.replace(originalSrc, wechatUrl);
    } catch (err) {
      console.error(`[inline-image] upload failed for ${originalSrc}:`, err);
      // 单张图片上传失败不阻断整体流程，保留原 URL
    }
  }

  return result;
}

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const { id } = await context.params;

  return withAuthUserConfig(user, async () => {
    const article = await findOwnedArticle(id, user.id, { images: true });
    if (!article) {
      return NextResponse.json(
        { code: 404, message: "article not found", data: null },
        { status: 404 }
      );
    }

    if (!article.content) {
      return NextResponse.json(
        {
          code: 1002,
          message: "正文为空，无法推送草稿",
          data: null,
        },
        { status: 400 }
      );
    }

    if (!isWechatReady()) {
      return NextResponse.json(
        {
          code: 1004,
          message: "尚未配置微信公众号。请先到「设置 → 微信公众号」填写 App ID 与 App Secret，再推送草稿箱。",
          data: null,
        },
        { status: 400 },
      );
    }

    try {
      let coverUrl = article.coverImageUrl ?? "";
      if (!coverUrl) {
        const { url } = await generateCoverImage(`editorial cover for ${article.topic}`);
        coverUrl = url;
        await db.article.update({
          where: { id },
          data: { coverImageUrl: coverUrl },
        });
      }

      const coverBuffer = await downloadToBuffer(coverUrl);
      if (!coverBuffer) {
        throw new Error("封面图下载失败，请检查图片 URL");
      }

      const token = await getAccessToken();
      const mediaId = await uploadMedia(
        token,
        coverBuffer,
        `cover-${id}.jpg`,
        "image",
      );

      const digest = buildWechatDigest(article.summary, article.content);
      const wechatContent = prependWechatDigest(convertToWechatHtml(article.content), digest);

      // 上传正文中的图片到微信并替换 URL（章节配图等）
      const contentWithImages = await replaceInlineImages(wechatContent, token);

      const draftId = await (await import("@/lib/wechat")).createDraft(token, {
        title: article.title ?? article.topic,
        content: contentWithImages,
        digest,
        thumbMediaId: mediaId,
      });

      await db.publishRecord.create({
        data: {
          articleId: id,
          channel: "wechat",
          status: "success",
          requestPayload: JSON.stringify({ articleId: id }),
          responsePayload: JSON.stringify({ mediaId, draftId }),
        },
      });

      const updated = await db.article.update({
        where: { id },
        data: {
          status: "pushed",
          wechatDraftId: draftId,
        },
      });

      return NextResponse.json({
        code: 0,
        message: "ok",
        data: {
          wechatDraftId: updated.wechatDraftId,
          status: updated.status,
          mediaId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "推送失败";
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
