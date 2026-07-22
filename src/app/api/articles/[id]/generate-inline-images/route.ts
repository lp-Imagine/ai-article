import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateSectionImagePrompt } from "@/lib/ai";
import { generateSectionImage } from "@/lib/image-gen";
import { syncConfigsToEnv } from "@/lib/config-bridge";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";

const INLINE_IMAGE_CONCURRENCY = 2;

type SectionJob = {
  insertAfter: number;
  heading: string;
  sectionContent: string;
  documentOrderIndex: number;
  sortOrder: number;
};

type SectionResult = {
  insertAfter: number;
  heading: string;
  url: string;
  prompt: string;
  sortOrder: number;
};

function isSkippedSectionHeading(heading: string) {
  return heading.includes("写在最后") || heading.includes("结尾") || heading.includes("总结");
}

function buildContentWithFigures(
  baseContent: string,
  results: SectionResult[],
  completedCount: number,
  totalToGenerate: number,
): string {
  const sorted = [...results].sort((a, b) => b.insertAfter - a.insertAfter);
  let content = baseContent;

  for (const result of sorted) {
    const figureHtml =
      `\n<figure data-progress="${completedCount}/${totalToGenerate}">\n` +
      `  <img src="${result.url}" alt="${result.heading}" />\n` +
      `  <figcaption>${result.heading}</figcaption>\n` +
      `</figure>\n`;
    content = content.slice(0, result.insertAfter) + figureHtml + content.slice(result.insertAfter);
  }

  return content;
}

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
    const baseContent = article.content.replace(/<figure[\s\S]*?<\/figure>/g, "");

    const h2Regex = /<h2[^>]*>(.*?)<\/h2>/g;
    const sectionMatches = [...baseContent.matchAll(h2Regex)];

    if (sectionMatches.length === 0) {
      return NextResponse.json(
        { code: 400, message: "文章中未找到 h2 章节标题", data: null },
        { status: 400 },
      );
    }

    await db.imageAsset.deleteMany({
      where: { articleId: id, type: "inline" },
    });

    const jobs: SectionJob[] = [];

    for (let i = 0; i < sectionMatches.length; i += 1) {
      const match = sectionMatches[i];
      const heading = match[1].replace(/<[^>]+>/g, "").trim();
      if (isSkippedSectionHeading(heading)) continue;

      const documentOrderIndex = sectionMatches
        .slice(0, i)
        .filter((m) => !isSkippedSectionHeading(m[1].replace(/<[^>]+>/g, "").trim())).length;

      const insertPos = match.index!;
      const afterSection = baseContent.slice(insertPos + match[0].length);
      const nextBreak = afterSection.search(/<h2|<hr\s*\/?>/);
      const rawContent =
        nextBreak === -1
          ? afterSection.slice(0, 1200)
          : afterSection.slice(0, Math.min(nextBreak, 1200));
      const sectionContent = rawContent.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

      jobs.push({
        insertAfter: insertPos + match[0].length,
        heading,
        sectionContent,
        documentOrderIndex,
        sortOrder: i,
      });
    }

    const totalToGenerate = jobs.length;
    if (totalToGenerate === 0) {
      return NextResponse.json(
        { code: 400, message: "没有可生成配图的章节", data: null },
        { status: 400 },
      );
    }

    const completedResults: SectionResult[] = [];
    let persistChain = Promise.resolve();

    const enqueuePersist = (result: SectionResult) => {
      persistChain = persistChain.then(async () => {
        completedResults.push(result);
        const content = buildContentWithFigures(
          baseContent,
          completedResults,
          completedResults.length,
          totalToGenerate,
        );

        await db.article.update({
          where: { id },
          data: { content },
        });

        await db.imageAsset.create({
          data: {
            articleId: id,
            type: "inline",
            source: "ai",
            url: result.url,
            prompt: result.prompt,
            sortOrder: result.sortOrder,
          },
        });
      });
    };

    const generationResults = await mapWithConcurrency(
      jobs,
      INLINE_IMAGE_CONCURRENCY,
      async (job) => {
        try {
          const prompt = await generateSectionImagePrompt(
            article.topic,
            article.style,
            job.heading,
            job.sectionContent,
            {
              sectionIndex: job.documentOrderIndex,
              totalSections: totalToGenerate,
            },
          );
          const { url } = await generateSectionImage(prompt);

          const result: SectionResult = {
            insertAfter: job.insertAfter,
            heading: job.heading,
            url,
            prompt,
            sortOrder: job.sortOrder,
          };

          await enqueuePersist(result);
          return result;
        } catch (err) {
          console.error(
            `[inline-image] failed for "${job.heading}":`,
            err instanceof Error ? err.message : err,
          );
          return null;
        }
      },
    );

    await persistChain;

    const generatedImages = generationResults
      .filter((item): item is SectionResult => item !== null)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ heading, url }) => ({ heading, url }));

    if (generatedImages.length === 0) {
      return NextResponse.json(
        { code: 500, message: "所有章节配图生成均失败", data: null },
        { status: 500 },
      );
    }

    const updatedContent = buildContentWithFigures(
      baseContent,
      completedResults,
      completedResults.length,
      totalToGenerate,
    );

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
