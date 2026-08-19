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

/** placehold.co 是未配置图片模型时的占位封面，不能作为微信素材上传 */
function isPlaceholderImage(url: string): boolean {
  return url.startsWith("https://placehold.co");
}

/** 取正文中第一张非占位图片的 src；没有则返回 null。 */
export function extractFirstImageSrc(html: string): string | null {
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(imgRegex)) {
    const src = match[1]?.trim();
    if (src && !isPlaceholderImage(src) && !src.startsWith("data:")) return src;
  }
  return null;
}

/** 上传图片到微信素材库，返回可用于草稿正文的 url（permanent material 同时返回 media_id） */
async function uploadInlineImage(
  accessToken: string,
  imageUrl: string,
): Promise<{ url: string; mediaId: string }> {
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

  if (!json.url || !json.media_id) {
    throw new Error(`微信图片上传失败: ${json.errmsg ?? "unknown"}`);
  }
  return { url: json.url, mediaId: json.media_id };
}

/**
 * 将正文中所有 <img src="..."> 的图片上传到微信并替换 URL。
 * 多张图片并发上传（默认 3 并发），单张失败不影响整体流程。
 * 返回替换后的正文，以及 原 src → media_id 的映射（供封面缺失时复用为缩略图）。
 */
async function replaceInlineImages(
  content: string,
  token: string,
): Promise<{ content: string; mediaBySrc: Map<string, string> }> {
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const srcs = [...content.matchAll(imgRegex)].map((m) => m[1]);

  if (srcs.length === 0) return { content, mediaBySrc: new Map() };

  // 同一张图可能在正文里出现多次（如章节配图复用），去重后只上传一次
  const pendingSrcs = [...new Set(srcs)].filter(
    (src) => !src.includes("mmbiz.qpic.cn") && !src.includes("mp.weixin.qq.com"),
  );
  if (pendingSrcs.length === 0) return { content, mediaBySrc: new Map() };

  // 并发上传（微信文档未限制并发；3 是经验值，避免一次拉满 DNS/连接池）
  const uploaded = await mapWithConcurrency(
    pendingSrcs,
    3,
    async (
      src,
    ): Promise<{ src: string; wechatUrl: string | null; mediaId: string | null }> => {
      try {
        const { url, mediaId } = await uploadInlineImage(token, src);
        return { src, wechatUrl: url, mediaId };
      } catch (err) {
        log.warn("inline image upload failed", {
          src,
          error: err instanceof Error ? err.message : String(err),
        });
        // 单张图片上传失败不阻断整体流程，保留原 URL
        return { src, wechatUrl: null, mediaId: null };
      }
    },
  );

  const urlBySrc = new Map<string, string>();
  const mediaBySrc = new Map<string, string>();
  for (const item of uploaded) {
    if (item.wechatUrl) urlBySrc.set(item.src, item.wechatUrl);
    if (item.mediaId) mediaBySrc.set(item.src, item.mediaId);
  }
  if (urlBySrc.size === 0) {
    return { content, mediaBySrc };
  }

  // 逐个 img 标签替换：若直接对 src 做全文替换，
  // 当一个 src 是另一个的前缀（a.png 与 a.png?v=2）时会互相破坏。
  const replaced = content.replace(imgRegex, (tag, src: string) => {
    const wechatUrl = urlBySrc.get(src);
    return wechatUrl ? tag.replace(src, () => wechatUrl) : tag;
  });

  return { content: replaced, mediaBySrc };
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

  const token = await getAccessToken();

  const digest = buildWechatDigest(article.summary, article.content);
  const wechatContent = prependWechatDigest(
    convertToWechatHtml(article.content),
    digest,
  );

  // 上传正文中的图片到微信并替换 URL（章节配图等）
  const { content: contentWithImages, mediaBySrc } = await replaceInlineImages(
    wechatContent,
    token,
  );

  // 微信草稿必须有封面缩略图（thumb_media_id）：
  // 1) 封面图可用（真实图片）→ 上传封面作缩略图；
  // 2) 封面是占位图 / 下载失败 → 复用正文首图（已上传，有 media_id），避免整篇推送失败；
  // 3) 都不可用 → 给出清晰指引，而不是模糊的「封面图下载失败」。
  const warnings: string[] = [];
  let thumbMediaId: string | null = null;

  const realCoverUrl = coverUrl && !isPlaceholderImage(coverUrl) ? coverUrl : null;
  if (realCoverUrl) {
    const coverBuffer = await downloadToBuffer(realCoverUrl);
    if (coverBuffer) {
      thumbMediaId = await uploadMedia(
        token,
        coverBuffer,
        `cover-${articleId}.jpg`,
        "image",
      );
    }
  }

  if (!thumbMediaId) {
    const firstInline = extractFirstImageSrc(article.content ?? "");
    thumbMediaId =
      (firstInline && mediaBySrc.get(firstInline)) ||
      mediaBySrc.values().next().value ||
      null;
    if (thumbMediaId) {
      warnings.push("封面图不可用，已使用正文图片作为封面缩略图");
    }
  }

  if (!thumbMediaId) {
    throw new PushDraftError(
      1004,
      "微信草稿需要封面图，但当前没有可用图片。请到「设置 → 图片模型」配置图片生成（或在正文中插入一张图片），然后重新生成封面后再推送。",
    );
  }

  const draftId = await (await import("@/lib/wechat")).createDraft(token, {
    title: article.title ?? article.topic,
    content: contentWithImages,
    digest,
    thumbMediaId,
  });

  await db.publishRecord.create({
    data: {
      articleId,
      channel: "wechat",
      status: "success",
      requestPayload: JSON.stringify({ articleId }),
      responsePayload: JSON.stringify({ mediaId: thumbMediaId, draftId }),
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
    warnings,
  };
}
