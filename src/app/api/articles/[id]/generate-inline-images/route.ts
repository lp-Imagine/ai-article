import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSectionImagePrompt } from "@/lib/ai";
import { generateSectionImage } from "@/lib/image-gen";
import { syncConfigsToEnv } from "@/lib/config-bridge";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  await syncConfigsToEnv();

  const article = await db.article.findUnique({
    where: { id },
  });

  if (!article) {
    return NextResponse.json(
      { code: 404, message: "文章不存在", data: null },
      { status: 404 },
    );
  }

  if (!article.content) {
    return NextResponse.json(
      { code: 400, message: "文章尚无正文", data: null },
      { status: 400 },
    );
  }

  try {
    // 先从正文里移除所有旧的 <figure>...</figure> 配图（覆盖语义）
    const baseContent = article.content.replace(
      /<figure[\s\S]*?<\/figure>/g,
      "",
    );

    // 从清理后的内容提取 h2 章节（避免旧 figure 导致索引偏移）
    const h2Regex = /<h2[^>]*>(.*?)<\/h2>/g;
    const sectionMatches = [...baseContent.matchAll(h2Regex)];

    if (sectionMatches.length === 0) {
      return NextResponse.json(
        { code: 400, message: "文章中未找到 h2 章节标题", data: null },
        { status: 400 },
      );
    }

    // 清理旧的 inline 图片记录
    await db.imageAsset.deleteMany({
      where: { articleId: id, type: "inline" },
    });

    // 在数据库里放置进度标记 - 用 image_assets 表里的 progress 字段标记当前进度
    // 这里用先写一条 placeholder 记录的方式让前端能感知
    const totalToGenerate = sectionMatches.filter((m) => {
      const heading = m[1].replace(/<[^>]+>/g, "").trim();
      return !heading.includes("写在最后") && !heading.includes("结尾") && !heading.includes("总结");
    }).length;

    // 为每个 h2 章节生成配图
    let updatedContent = baseContent;
    const generatedImages: Array<{ heading: string; url: string }> = [];
    let generatedCount = 0;

    // 从后往前插入图片，避免索引偏移
    for (let i = sectionMatches.length - 1; i >= 0; i--) {
      const match = sectionMatches[i];
      const heading = match[1].replace(/<[^>]+>/g, "").trim();

      // 跳过"写在最后"等结尾章节
      if (heading.includes("写在最后") || heading.includes("结尾") || heading.includes("总结")) {
        continue;
      }

      const documentOrderIndex = sectionMatches
        .slice(0, i)
        .filter((m) => {
          const h = m[1].replace(/<[^>]+>/g, "").trim();
          return !h.includes("写在最后") && !h.includes("结尾") && !h.includes("总结");
        }).length;

      // 提取该章节的内容（去掉 HTML 标签，取更多上下文）
      const insertPos = match.index!;
      const afterSection = baseContent.slice(insertPos + match[0].length);
      const nextBreak = afterSection.search(/<h2|<hr\s*\/?>/);
      const rawContent = nextBreak === -1
        ? afterSection.slice(0, 1200)
        : afterSection.slice(0, Math.min(nextBreak, 1200));
      // 去掉 HTML 标签，只保留纯文本
      const sectionContent = rawContent.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

      // 在生成前先更新进度 - 用一个 sentinel 文本标记
      // 这里直接把当前生成进度作为 figure 的 alt 标记，方便前端轮询识别
      try {
        const prompt = await generateSectionImagePrompt(
          article.topic,
          article.style,
          heading,
          sectionContent,
          { sectionIndex: documentOrderIndex, totalSections: totalToGenerate },
        );
        const { url } = await generateSectionImage(prompt);

        const figureHtml = `\n<figure data-progress="${generatedCount + 1}/${totalToGenerate}">\n  <img src="${url}" alt="${heading}" />\n  <figcaption>${heading}</figcaption>\n</figure>\n`;

        const before = updatedContent.slice(0, insertPos + match[0].length);
        const after = updatedContent.slice(insertPos + match[0].length);
        updatedContent = before + figureHtml + after;

        generatedImages.unshift({ heading, url });
        generatedCount += 1;

        // 每生成一张图就立刻写回数据库（包含进度信息），让前端可以轮询
        await db.article.update({
          where: { id },
          data: { content: updatedContent },
        });

        // 记录到最终 image_assets 表
        await db.imageAsset.create({
          data: {
            articleId: id,
            type: "inline",
            source: "ai",
            url,
            prompt,
            sortOrder: i,
          },
        });
      } catch (err) {
        console.error(`[inline-image] failed for "${heading}":`, err instanceof Error ? err.message : err);
        continue;
      }
    }

    if (generatedImages.length === 0) {
      return NextResponse.json(
        { code: 500, message: "所有章节配图生成均失败", data: null },
        { status: 500 },
      );
    }

    // 保存更新后的正文（再次确保最终版本）
    const updated = await db.article.update({
      where: { id },
      data: {
        content: updatedContent,
        status: article.status === "generated" ? "edited" : article.status,
      },
    });

    return NextResponse.json({
      code: 0,
      message: `已为 ${generatedImages.length} 个章节生成配图`,
      data: { content: updated.content, images: generatedImages, total: totalToGenerate },
    });
  } catch (error) {
    return NextResponse.json(
      {
        code: 1500,
        message: error instanceof Error ? error.message : "生成配图失败",
        data: null,
      },
      { status: 500 },
    );
  }
}