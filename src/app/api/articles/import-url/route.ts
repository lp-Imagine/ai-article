import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import {
  assertSafeImportUrl,
  extractArticleFromHtmlPage,
  ImportContentError,
  IMPORT_CONTENT_MAX_CHARS,
} from "@/lib/import-content";
import { fetchWithTimeout } from "@/lib/retry";

const bodySchema = z.object({
  url: z.string().trim().min(1, "请输入网页链接").max(2000),
});

const FETCH_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 2_500_000;

/** 从公开网页抓取标题与正文，供导入表单预填（不落库） */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (user instanceof NextResponse) return user;

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.parse(json);
    const url = assertSafeImportUrl(parsed.url);

    const res = await fetchWithTimeout(
      url.href,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; DraftlyImporter/1.0; +https://github.com/lp-Imagine/ai-article)",
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        redirect: "follow",
      },
      FETCH_TIMEOUT_MS,
      "网页抓取",
    );

    if (!res.ok) {
      throw new ImportContentError(`网页抓取失败（HTTP ${res.status}）`);
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml") &&
      !contentType.includes("text/plain")
    ) {
      throw new ImportContentError("该链接不是网页，请粘贴 HTML/Markdown 或上传文件");
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_HTML_BYTES) {
      throw new ImportContentError("网页过大，请改用粘贴或上传文件");
    }

    const html = buf.toString("utf8");
    if (html.length > IMPORT_CONTENT_MAX_CHARS * 4) {
      throw new ImportContentError("网页内容过大，请改用粘贴或上传文件");
    }

    // 纯文本页：整页当正文
    if (contentType.includes("text/plain") || !/<html[\s>]/i.test(html)) {
      const text = html.trim();
      if (text.length < 40) {
        throw new ImportContentError("网页正文过短");
      }
      return NextResponse.json({
        code: 0,
        message: "ok",
        data: {
          title: text.split(/\n+/).find((l) => l.trim())?.trim().slice(0, 80) || "未命名文章",
          content: text.slice(0, IMPORT_CONTENT_MAX_CHARS),
          summary: null as string | null,
          sourceUrl: url.href,
        },
      });
    }

    const extracted = extractArticleFromHtmlPage(html, { url: url.href });
    return NextResponse.json({
      code: 0,
      message: "ok",
      data: {
        ...extracted,
        content: extracted.content.slice(0, IMPORT_CONTENT_MAX_CHARS),
        sourceUrl: url.href,
      },
    });
  } catch (error) {
    if (error instanceof NextResponse) return error;
    const message =
      error instanceof ImportContentError
        ? error.message
        : error instanceof z.ZodError
          ? error.issues[0]?.message || "参数错误"
          : error instanceof Error
            ? error.message
            : "网页抓取失败";
    return NextResponse.json({ code: 1000, message, data: null }, { status: 400 });
  }
}
