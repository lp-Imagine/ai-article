import { PrismaClient } from "@prisma/client";
import { syncArticleToBlog } from "../src/lib/blog-sync";

const db = new PrismaClient();
const id = process.argv[2] || "cmrxngdq9000zpzulezqj56nc";
const section = (process.argv[3] || "web") as "web" | "ui" | "tech" | "computer" | "misc";
const group = process.argv[4] || "javascript";

async function main() {
  const article = await db.article.findUnique({ where: { id } });
  if (!article?.content) throw new Error("article missing or empty");

  console.log("syncing:", article.title || article.topic, "→", section, "/", group);

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
      section,
      group,
      tags: article.keywords ? undefined : ["JavaScript"],
      draft: false,
    },
  );

  await db.publishRecord.create({
    data: {
      articleId: id,
      channel: "blog",
      status: "success",
      requestPayload: JSON.stringify({ section }),
      responsePayload: JSON.stringify(result),
    },
  });

  console.log("OK", result);
}

main()
  .catch(async (e) => {
    console.error("FAIL", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
