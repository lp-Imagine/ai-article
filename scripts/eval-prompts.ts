import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateArticle } from "../src/lib/ai/evaluation";
import type { OutlineOption } from "../src/types/article";

type EvalSample = {
  topic: string;
  title: string;
  content: string;
  outlines?: OutlineOption[];
};

const TOPICS = [
  "前端 monorepo 治理：Turborepo 还是 Nx",
  "RAG 之外：让 AI 用上私有数据的工程方案",
  "一个人做内容产品，如何验证选题",
  "租房时最容易忽略的合同风险",
  "普通人如何建立长期学习系统",
];

const REFERENCE_SAMPLES: EvalSample[] = [
  {
    topic: "bad-template-control",
    title: "长期学习方法论",
    content: `<p>在当今时代，随着技术发展，学习的重要性不言而喻。</p>
      <h2>什么是长期学习</h2><p>关键在于持续努力，实现认知升级和自我赋能。</p>
      <h2>总结与展望</h2><p>关键在于持续努力，实现认知升级和自我赋能。</p>`,
  },
  {
    topic: "good-concrete-control",
    title: "租房合同先查这三处",
    content: `<p>签字前先核对出租人姓名和房产证；不是本人时，要求查看授权委托书。</p>
      <h2>把提前解约写成金额</h2><p>例如把“协商解决”改成提前 30 天通知并支付 1 个月租金。</p>
      <h2>交房当天留下证据</h2><p>按房间拍摄水表、电表和墙面，文件名写成日期加房间位置。</p>`,
  },
];

async function loadSnapshot(path: string): Promise<EvalSample[]> {
  const parsed = JSON.parse(await readFile(resolve(path), "utf8")) as EvalSample | EvalSample[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function generateLiveSamples(): Promise<EvalSample[]> {
  if (process.env.PROMPT_EVAL_LIVE !== "1") return [];
  const { generateContent, generateOutline } = await import("../src/lib/ai");
  const samples: EvalSample[] = [];
  for (const topic of TOPICS) {
    const outlines = await generateOutline({ topic, outlineCount: 3, wordCount: 1200 });
    const generated = await generateContent({ topic, outline: outlines[0], wordCount: 1200 });
    samples.push({ topic, title: generated.title, content: generated.content, outlines });
  }
  return samples;
}

async function main() {
  const inputIndex = process.argv.indexOf("--input");
  const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : undefined;
  const liveSamples = await generateLiveSamples();
  const samples = liveSamples.length
    ? liveSamples
    : inputPath
      ? await loadSnapshot(inputPath)
      : REFERENCE_SAMPLES;

  console.table(
    samples.map((sample) => ({
      topic: sample.topic,
      ...evaluateArticle(sample),
    })),
  );

  if (!liveSamples.length && !inputPath) {
    console.log("\nDefault mode validates deterministic metrics only; no model was called.");
    console.log("Snapshot: npm run eval:prompts -- --input path/to/generated.json");
    console.log("Live (costs model tokens): PROMPT_EVAL_LIVE=1 npm run eval:prompts");
    console.log(`Live topic fixtures (${TOPICS.length}):\n- ${TOPICS.join("\n- ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
