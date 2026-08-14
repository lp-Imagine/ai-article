import { db } from "@/lib/db";
import { downloadToBuffer, generateCoverImage } from "@/lib/image-gen";
import {
  isReady as isWechatReady,
  getAccessToken,
  uploadMedia,
  buildWechatDigest,
} from "@/lib/wechat";
import { convertToWechatHtml, prependWechatDigest } from "@/lib/wechat-style";
import { findOwnedArticle } from "@/lib/api-auth";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import { log } from "@/lib/log";

export class PushDraftError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "PushDraftError";
    this.code = code;
  }
}

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

/**
 * 将正文中所有 <img src="..."> 的图片上传到微信并替换 URL。
 * 多张图片并发上传（默认 3 并发），单张失败不影响整体流程。
 */
async function replaceInlineImages(
  content: string,
  token: string,
): Promise<string> {
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const srcs = [...content.matchAll(imgRegex)].map((m) => m[1]);

  if (srcs.length === 0) return content;

  // 同一张图可能在正文里出现多次（如章节配图复用），去重后只上传一次
  const pendingSrcs = [...new Set(srcs)].filter(
    (src) => !src.includes("mmbiz.qpic.cn") && !src.includes("mp.weixin.qq.com"),
  );
  if (pendingSrcs.length === 0) return content;

  // 并发上传（微信文档未限制并发；3 是经验值，避免一次拉满 DNS/连接池）
  const uploaded = await mapWithConcurrency(
    pendingSrcs,
    3,
    async (src): Promise<{ src: string; wechatUrl: string | null }> => {
      try {
        const wechatUrl = await uploadInlineImage(token, src);
        return { src, wechatUrl };
      } catch (err) {
        log.warn("inline image upload failed", {
          src,
          error: err instanceof Error ? err.message : String(err),
        });
        // 单张图片上传失败不阻断整体流程，保留原 URL
        return { src, wechatUrl: null };
      }
    },
  );

  const urlBySrc = new Map<string, string>();
  for (const item of uploaded) {
    if (item.wechatUrl) urlBySrc.set(item.src, item.wechatUrl);
  }
  if (urlBySrc.size === 0) return content;

  // 逐个 img 标签替换：若直接对 src 做全文替换，
  // 当一个 src 是另一个的前缀（a.png 与 a.png?v=2）时会互相破坏。
  return content.replace(imgRegex, (tag, src: string) => {
    const wechatUrl = urlBySrc.get(src);
    return wechatUrl ? tag.replace(src, () => wechatUrl) : tag;
  });
}

export type PushDraftResult = {
  draftMediaId: string;
  title: string;
  warnings: string[];
};

/**
 * 推送文章到微信公众号草稿箱的核心逻辑。
 * 供 push-draft API 路由与定时任务的自动推送复用。
 * 需要 article 所属用户的配置已注入（withUserConfig 上下文或环境变量）。
 */
export async function pushArticleToWechatDraft(input: {
  articleId: string;
  userId: string;
}): Promise<PushDraftResult> {
  const { articleId, userId } = input;

  const article = await findOwnedArticle(articleId, userId, { images: true });
  if (!article) throw new PushDraftError(404, "article not found");

  if (!article.content) {
    throw new PushDraftError(1002, "正文为空，无法推送草稿");
  }

  if (!isWechatReady()) {
    throw new PushDraftError(
      1004,
      "尚未配置微信公众号。请先到「设置 → 微信公众号」填写 App ID 与 App Secret，再推送草稿箱。",
    );
  }

  let coverUrl = article.coverImageUrl ?? "";
  if (!coverUrl) {
    const { url } = await generateCoverImage(
      `editorial cover for ${article.topic}`,
    );
    coverUrl = url;
    await db.article.update({
      where: { id: articleId },
      data: { coverImageUrl: coverUrl },
    });
  }

  const coverBuffer = await downloadToBuffer(coverUrl);
  if (!coverBuffer) {
    throw new PushDraftError(1501, "封面图下载失败，请检查图片 URL");
  }

  const token = await getAccessToken();
  const mediaId = await uploadMedia(
    token,
    coverBuffer,
    `cover-${articleId}.jpg`,
    "image",
  );

  const digest = buildWechatDigest(article.summary, article.content);
  const wechatContent = prependWechatDigest(
    convertToWechatHtml(article.content),
    digest,
  );

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
      articleId,
      channel: "wechat",
      status: "success",
      requestPayload: JSON.stringify({ articleId }),
      responsePayload: JSON.stringify({ mediaId, draftId }),
    },
  });

  await db.article.update({
    where: { id: articleId },
    data: {
      status: "pushed",
      wechatDraftId: draftId,
    },
  });

  return {
    draftMediaId: draftId,
    title: article.title ?? article.topic,
    warnings: [],
  };
}
