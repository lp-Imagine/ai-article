import type { GenerationJob, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  generateContent,
  generateCoverPrompt,
  generateOutline,
  polishContent,
  reformatArticleHtml,
  expandSection,
  generateSectionImagePrompt,
  refineContentQuality,
} from "@/lib/ai";
import { analyzeContentQuality } from "@/lib/content-quality";
import { generateCoverImage, generateSectionImage } from "@/lib/image-gen";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";
import { withRetry } from "@/lib/retry";
import { withUserConfig } from "@/lib/config-bridge";

type OutlineRecord = {
  index: number;
  title: string;
  positioning: string;
  sections: Array<{ heading: string; summary: string }>;
};

type ProgressUpdater = (progress: number, stepLabel: string) => Promise<void>;

async function updateJobProgress(jobId: string, progress: number, stepLabel: string) {
  await db.generationJob.update({
    where: { id: jobId },
    data: { progress, stepLabel },
  });
}

export async function runGenerationJob(job: GenerationJob): Promise<Prisma.InputJsonValue | null> {
  return withUserConfig(job.userId, async () => {
    const update: ProgressUpdater = (progress, stepLabel) =>
      updateJobProgress(job.id, progress, stepLabel);

    switch (job.type) {
      case "outline":
        return runOutline(job, update);
      case "content":
        return runContent(job, update);
      case "cover":
        return runCover(job, update);
      case "inline_images":
        return runInlineImages(job, update);
      case "polish":
        return runPolish(job, update);
      case "expand":
        return runExpand(job, update);
      default:
        throw new Error(`未知任务类型: ${job.type}`);
    }
  });
}

async function runOutline(job: GenerationJob, update: ProgressUpdater) {
  await update(5, "读取文章");
  const article = await db.article.findFirst({
    where: { id: job.articleId, userId: job.userId },
  });
  if (!article) throw new Error("文章不存在");

  const payload = (job.payload ?? {}) as { outlineCount?: number };
  let outlineCount = article.outlineCount ?? 3;
  if (typeof payload.outlineCount === "number" && payload.outlineCount >= 2 && payload.outlineCount <= 6) {
    outlineCount = payload.outlineCount;
  }

  await update(20, "调用 AI 生成大纲");
  const outlines = await generateOutline({
    topic: article.topic,
    style: article.style,
    wordCount: article.wordCount,
    audience: article.audience,
    goal: article.goal,
    keywords: article.keywords,
    outlineCount,
  });

  await update(85, "保存大纲");
  await db.article.update({
    where: { id: article.id },
    data: {
      outline: outlines,
      outlineCount,
      status: "outlined",
    },
  });

  await db.articleVersion.create({
    data: {
      articleId: article.id,
      versionType: "outline",
      source: "ai",
      outline: outlines,
    },
  });

  await update(100, "完成");
  return { outlines, count: outlines.length };
}

async function runContent(job: GenerationJob, update: ProgressUpdater) {
  await update(5, "读取大纲");
  const article = await db.article.findFirst({
    where: { id: job.articleId, userId: job.userId },
  });
  if (!article) throw new Error("文章不存在");

  const outlines = Array.isArray(article.outline) ? (article.outline as OutlineRecord[]) : [];
  if (typeof article.selectedOutlineIndex !== "number") {
    throw new Error("请先选择一个大纲方案，再生成正文");
  }
  const selectedOutline = outlines[article.selectedOutlineIndex] ?? null;
  if (!selectedOutline) throw new Error("所选大纲不存在，请重新选择");

  await update(15, "生成正文");
  let generated = await generateContent(
    {
      topic: article.topic,
      outline: selectedOutline,
      style: article.style,
      wordCount: article.wordCount,
      audience: article.audience,
      goal: article.goal,
      keywords: article.keywords,
    },
    {
      onProgress: async (stepLabel, stepIndex, stepTotal) => {
        const progress = 15 + Math.floor(((stepIndex + 1) / Math.max(stepTotal, 1)) * 45);
        await update(progress, stepLabel);
      },
    },
  );

  await update(65, "精炼正文 + 生成封面图");

  // 封面只依赖标题/摘要/内容梗概，与精炼互不影响，并行省掉一整轮等待
  const coverTask = (async () => {
    const keyPoints = (selectedOutline.sections ?? []).slice(0, 3).map((s) => s.heading);
    const coverPrompt = await generateCoverPrompt(article.topic, article.style, {
      title: generated.title,
      summary: generated.summary,
      keyPoints: keyPoints.length > 0 ? keyPoints : undefined,
      contentExcerpt: generated.content,
    });
    const cover = await generateCoverImage(coverPrompt);
    await db.imageAsset.create({
      data: {
        articleId: article.id,
        type: "cover",
        source: cover.source === "ai" ? "ai" : "upload",
        url: cover.url,
        prompt: coverPrompt,
      },
    });
    return cover.url;
  })();

  // 生成后精炼关：去套话、提信息密度，降低微信「低质 AIGC」风险
  const [refined, coverResult] = await Promise.all([
    refineContentQuality({
      topic: article.topic,
      title: generated.title,
      summary: generated.summary,
      content: generated.content,
      style: article.style,
    }),
    coverTask.then(
      (url) => ({ url, error: null as string | null }),
      (err: unknown) => ({
        url: null,
        error: err instanceof Error ? err.message : "封面图生成失败",
      }),
    ),
  ]);

  if (refined.refined) {
    generated = {
      ...generated,
      content: refined.content,
      summary: refined.summary ?? generated.summary,
    };
  } else if (!refined.skipped) {
    // 精炼未改写时，若启发式仍偏低也继续用初稿，但记入日志便于排查
    const preCheck = analyzeContentQuality({
      title: generated.title,
      summary: generated.summary,
      content: generated.content,
    });
    if (preCheck.score < 70) {
      console.warn(
        `[job:content] quality score low (${preCheck.score}):`,
        preCheck.issues.map((i) => i.code).join(","),
      );
    }
  }

  const coverImageUrl = coverResult.url;
  const coverWarning = coverResult.error;
  if (coverWarning) {
    console.error("[job:content] cover failed:", coverWarning);
  }

  await update(90, "保存正文");
  const updated = await db.article.update({
    where: { id: article.id },
    data: {
      title: generated.title,
      summary: generated.summary,
      content: generated.content,
      ...(coverImageUrl ? { coverImageUrl } : {}),
      status: "generated",
    },
  });

  await db.articleVersion.create({
    data: {
      articleId: article.id,
      versionType: "generated",
      source: "ai",
      title: generated.title,
      summary: generated.summary,
      content: generated.content,
    },
  });

  await update(100, "完成");
  return {
    articleId: updated.id,
    coverImageUrl: updated.coverImageUrl,
    coverWarning,
    ...(generated.missingSections.length > 0
      ? { contentWarning: `以下章节生成失败，已跳过：${generated.missingSections.join("、")}` }
      : {}),
    qualityScore: analyzeContentQuality({
      title: generated.title,
      summary: generated.summary,
      content: generated.content,
    }).score,
  };
}

async function runCover(job: GenerationJob, update: ProgressUpdater) {
  await update(10, "准备封面提示词");
  const article = await db.article.findFirst({
    where: { id: job.articleId, userId: job.userId },
  });
  if (!article) throw new Error("文章不存在");

  const outlines = Array.isArray(article.outline)
    ? (article.outline as Array<{ sections?: Array<{ heading: string }> }>)
    : [];
  const selectedIdx = typeof article.selectedOutlineIndex === "number" ? article.selectedOutlineIndex : 0;
  const selectedOutline = outlines[selectedIdx];
  const keyPoints = (selectedOutline?.sections ?? []).slice(0, 3).map((s) => s.heading);

  await update(30, "生成封面图");
  const prompt = await generateCoverPrompt(article.topic, article.style, {
    title: article.title,
    summary: article.summary,
    keyPoints: keyPoints.length > 0 ? keyPoints : undefined,
    contentExcerpt: article.content,
  });
  const { url, source } = await generateCoverImage(prompt);

  await update(85, "保存封面");
  const image = await db.imageAsset.create({
    data: {
      articleId: article.id,
      type: "cover",
      source: source === "ai" ? "ai" : "external",
      url,
      prompt,
      sortOrder: 0,
    },
  });

  const updated = await db.article.update({
    where: { id: article.id },
    data: {
      coverImageUrl: url,
      status: article.status === "draft" ? "edited" : article.status,
    },
  });

  await update(100, "完成");
  return { coverImageUrl: updated.coverImageUrl, imageId: image.id, prompt };
}

function getInlineImageConcurrency(): number {
  const raw = Number(process.env.INLINE_IMAGE_CONCURRENCY ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
}

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

async function runInlineImages(job: GenerationJob, update: ProgressUpdater) {
  await update(5, "解析章节");
  const article = await db.article.findFirst({
    where: { id: job.articleId, userId: job.userId },
  });
  if (!article) throw new Error("文章不存在");
  if (!article.content) throw new Error("文章尚无正文");

  const baseContent = article.content.replace(/<figure[\s\S]*?<\/figure>/g, "");
  const h2Regex = /<h2[^>]*>(.*?)<\/h2>/g;
  const sectionMatches = [...baseContent.matchAll(h2Regex)];
  if (sectionMatches.length === 0) throw new Error("文章中未找到 h2 章节标题");

  await db.imageAsset.deleteMany({
    where: { articleId: article.id, type: "inline" },
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
        ? afterSection.slice(0, 1800)
        : afterSection.slice(0, Math.min(nextBreak, 1800));
    // 保留列表/代码痕迹，便于关键词提炼（不要压成一句长空白）
    const sectionContent = rawContent
      .replace(/<\/(p|li|h3|pre|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();

    jobs.push({
      insertAfter: insertPos + match[0].length,
      heading,
      sectionContent,
      documentOrderIndex,
      sortOrder: i,
    });
  }

  const totalToGenerate = jobs.length;
  if (totalToGenerate === 0) throw new Error("没有可生成配图的章节");

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
        where: { id: article.id },
        data: { content },
      });

      await db.imageAsset.create({
        data: {
          articleId: article.id,
          type: "inline",
          source: "ai",
          url: result.url,
          prompt: result.prompt,
          sortOrder: result.sortOrder,
        },
      });

      const progress = Math.min(95, Math.round((completedResults.length / totalToGenerate) * 90) + 5);
      await update(progress, `已生成 ${completedResults.length}/${totalToGenerate} 张配图`);
    });
  };

  await update(10, `正在生成第 1/${totalToGenerate} 张配图`);

  const generationResults = await mapWithConcurrency(jobs, getInlineImageConcurrency(), async (sectionJob) => {
    try {
      const { prompt, url } = await withRetry(
        async () => {
          const prompt = await generateSectionImagePrompt(
            article.topic,
            article.style,
            sectionJob.heading,
            sectionJob.sectionContent,
            {
              sectionIndex: sectionJob.documentOrderIndex,
              totalSections: totalToGenerate,
            },
          );
          const { url } = await generateSectionImage(prompt);
          return { prompt, url };
        },
        { attempts: 2, baseDelayMs: 1500 },
      );
      const result: SectionResult = {
        insertAfter: sectionJob.insertAfter,
        heading: sectionJob.heading,
        url,
        prompt,
        sortOrder: sectionJob.sortOrder,
      };
      await enqueuePersist(result);
      return result;
    } catch (err) {
      console.error(
        `[job:inline] failed for "${sectionJob.heading}":`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  });

  await persistChain;

  const generatedImages = generationResults
    .filter((item): item is SectionResult => item !== null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ heading, url }) => ({ heading, url }));

  if (generatedImages.length === 0) throw new Error("所有章节配图生成均失败");

  const updatedContent = buildContentWithFigures(
    baseContent,
    completedResults,
    completedResults.length,
    totalToGenerate,
  );

  await db.article.update({
    where: { id: article.id },
    data: {
      content: updatedContent,
      status: article.status === "generated" ? "edited" : article.status,
    },
  });

  await update(100, "完成");
  return { images: generatedImages, total: totalToGenerate };
}

async function runPolish(job: GenerationJob, update: ProgressUpdater) {
  await update(10, "读取正文");
  const article = await db.article.findFirst({
    where: { id: job.articleId, userId: job.userId },
  });
  if (!article) throw new Error("文章不存在");
  if (!article.content) throw new Error("正文为空，先生成正文再润色");

  const payload = (job.payload ?? {}) as {
    mode?: "更正式" | "更口语" | "更简洁" | "更营销" | "reformat";
  };
  const mode = payload.mode ?? "更简洁";
  const isReformat = mode === "reformat";

  await update(30, isReformat ? "整理格式中" : "润色中");
  const content = isReformat
    ? await reformatArticleHtml({
        content: article.content,
        onProgress: (progress, label) => update(progress, label),
      })
    : await polishContent({
        content: article.content,
        mode: mode as "更正式" | "更口语" | "更简洁" | "更营销",
      });

  await update(85, "保存");
  await db.articleVersion.create({
    data: {
      articleId: article.id,
      versionType: "polished",
      source: "ai",
      title: article.title,
      summary: article.summary,
      content,
    },
  });

  await db.article.update({
    where: { id: article.id },
    data: { content, status: "edited" },
  });

  await update(100, "完成");
  return { mode };
}

async function runExpand(job: GenerationJob, update: ProgressUpdater) {
  await update(10, "读取正文");
  const article = await db.article.findFirst({
    where: { id: job.articleId, userId: job.userId },
  });
  if (!article) throw new Error("文章不存在");
  if (!article.content) throw new Error("正文为空，先生成正文再扩写");

  const payload = (job.payload ?? {}) as { instruction?: string };
  await update(30, "扩写中");
  const content = await expandSection({
    content: article.content,
    instruction: payload.instruction,
  });

  await update(85, "保存");
  await db.articleVersion.create({
    data: {
      articleId: article.id,
      versionType: "polished",
      source: "ai",
      title: article.title,
      summary: article.summary,
      content,
    },
  });

  await db.article.update({
    where: { id: article.id },
    data: { content, status: "edited" },
  });

  await update(100, "完成");
  return { ok: true };
}
