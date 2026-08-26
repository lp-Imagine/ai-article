/**
 * Sync Draftly articles to penn-notes via GitHub Contents API + repository_dispatch.
 * Contract: penn-notes/docs/SYNC.md
 * 正文路径用可读 slug；sourceId 留 frontmatter；upsert 时清理同 sourceId / 旧 id 文件名的残留路径。
 */
import { downloadToBuffer } from "@/lib/image-gen";
import { log } from "@/lib/log";
import { fetchWithTimeout } from "@/lib/retry";
import { assertSafeImportUrl } from "@/lib/import-content";
import {
  collectImageSrcs,
  guessImageExt,
  htmlToBlogMarkdown,
} from "@/lib/html-to-blog-md";
import { BLOG_SECTIONS, type BlogSection, inferBlogGroup, inferBlogPlacement, isValidBlogGroup } from "@/lib/blog-sync-constants";
import { getEnvValue } from "@/lib/config-bridge";

export { BLOG_SECTIONS, type BlogSection };

/** 抓取正文图片的单次超时：卡住的 CDN 不应拖垮整个同步任务 */
const IMAGE_FETCH_TIMEOUT_MS = 30_000;
/** 单张正文图片大小上限（8MB）：防止超大图拖慢同步与撑爆仓库 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type BlogSyncArticle = {
  id: string;
  title: string | null;
  topic: string;
  summary: string | null;
  content: string | null;
  coverImageUrl: string | null;
  keywords: string | null;
  createdAt: Date;
};

export type BlogSyncOptions = {
  /** 省略时根据标题/摘要/关键词自动推断 */
  section?: BlogSection;
  /** 侧栏分组，如 javascript / css / docs；省略时自动推断 */
  group?: string;
  tags?: string[];
  draft?: boolean;
};

export type BlogSyncResult = {
  path: string;
  url: string;
  coverPath: string | null;
  commitPaths: string[];
};

type GhConfig = {
  token: string;
  repo: string;
  branch: string;
  siteUrl: string;
};

/** 推送 GitHub 前脱敏，避免 Secret scanning 把示例代码里的假 key 当成真密钥 */
function scrubSecretsForPublish(text: string): string {
  return text
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, "YOUR_API_KEY")
    .replace(/\bghp_[a-zA-Z0-9]{20,}\b/g, "ghp_YOUR_GITHUB_TOKEN")
    .replace(/\bgithub_pat_[a-zA-Z0-9_]+\b/g, "github_pat_YOUR_TOKEN")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "AKIAYOURACCESSKEYID");
}

function readEnv(key: string): string {
  // 用户配置 (withUserConfig 注入) 优先，回退服务器 .env。
  return (getEnvValue(key) ?? process.env[key] ?? "").trim();
}

function readGhConfig(): GhConfig {
  const token = readEnv("BLOG_GITHUB_TOKEN");
  if (!token) {
    throw new Error(
      "尚未配置博客同步。请在 /settings「博客同步」中填写 GitHub Token（需 contents:write + actions:write）。",
    );
  }
  const repo = readEnv("BLOG_GITHUB_REPO") || "lp-Imagine/vuepressblog";
  const branch = readEnv("BLOG_GITHUB_BRANCH") || "master";
  const siteUrl = (
    readEnv("BLOG_SITE_URL") || "https://lp-imagine.github.io/vuepressblog/"
  ).replace(/\/?$/, "/");
  return { token, repo, branch, siteUrl };
}

export function isBlogSyncConfigured(): boolean {
  return Boolean(readEnv("BLOG_GITHUB_TOKEN"));
}

function yamlQuote(value: string): string {
  if (/[:#{}[\],&*?|>!%@`]/.test(value) || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 标题 → 可读文件名（与 penn-notes 手写笔记风格一致）。
 * 去掉路径非法字符与常见中英文标点，空白收成 `-`；空结果回退 fallback（通常为 sourceId）。
 */
export function slugFromTitle(title: string, fallback = "untitled"): string {
  const slug = title
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/[：:，,？?！!；;]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (slug || fallback).slice(0, 80);
}

function sourceIdLineRe(sourceId: string): RegExp {
  return new RegExp(`^sourceId:\\s*${escapeRegExp(sourceId)}\\s*$`, "m");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** List file/dir names under a repo path (Contents API). Missing dir → []. */
async function listRepoDir(
  dirPath: string,
  config: GhConfig,
): Promise<Array<{ name: string; path: string; type: string }>> {
  const [owner, repo] = config.repo.split("/");
  if (!owner || !repo) return [];

  const encodedPath = dirPath
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");

  const getRes = await githubRequest(
    config,
    "GET",
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`,
  );
  if (!getRes.ok) return [];
  const raw = getRes.json as unknown;
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((item) => ({
      name: typeof item.name === "string" ? item.name : "",
      path: typeof item.path === "string" ? item.path : "",
      type: typeof item.type === "string" ? item.type : "",
    }))
    .filter((item) => item.name && item.path);
}

/** Read utf8 text of a repo file; 404 → null. */
async function getRepoFileText(
  path: string,
  config: GhConfig,
): Promise<string | null> {
  const [owner, repo] = config.repo.split("/");
  if (!owner || !repo) return null;

  const encodedPath = path
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");

  const getRes = await githubRequest(
    config,
    "GET",
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`,
  );
  if (!getRes.ok || typeof getRes.json.content !== "string") return null;
  const encoding = getRes.json.encoding === "base64" ? "base64" : "utf8";
  try {
    return Buffer.from(getRes.json.content.replace(/\n/g, ""), encoding).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}

/**
 * Collect paths that belong to this article but are not the preferred slug file
 * (old id.md、改标题遗留、sync/ 旧路径、栏目迁移留下的 id 文件名).
 */
export async function collectStaleArticlePaths(opts: {
  sourceId: string;
  section: BlogSection;
  group: string;
  preferredPath: string;
  config?: GhConfig;
}): Promise<string[]> {
  const config = opts.config ?? readGhConfig();
  const stale = new Set<string>();
  const idPath = `website/${opts.section}/${opts.group}/${opts.sourceId}.md`;
  if (idPath !== opts.preferredPath) stale.add(idPath);
  stale.add(`website/sync/${opts.section}/${opts.group}/${opts.sourceId}.md`);
  stale.add(`website/sync/${opts.section}/${opts.sourceId}.md`);

  // 全库 id 文件名（栏目迁移后仍可能残留）
  for (const p of await findIdNamedMdPaths(opts.sourceId, config)) {
    if (p !== opts.preferredPath) stale.add(p);
  }

  // 当前分组内：改标题后旧可读文件名靠 sourceId 识别
  const siblings = await listRepoDir(
    `website/${opts.section}/${opts.group}`,
    config,
  );
  const idRe = sourceIdLineRe(opts.sourceId);
  for (const item of siblings) {
    if (item.type !== "file" || !item.name.endsWith(".md")) continue;
    if (item.path === opts.preferredPath) continue;
    if (item.name === `${opts.sourceId}.md`) {
      stale.add(item.path);
      continue;
    }
    const text = await getRepoFileText(item.path, config);
    if (text && idRe.test(text)) stale.add(item.path);
  }

  return [...stale];
}

/**
 * 决定写入路径：优先复用同分组内已有 sourceId 文件（稳定 URL），
 * 否则用标题 slug；若仅有旧 id.md 则迁移到 slug。
 */
export async function resolveArticleMdPath(opts: {
  sourceId: string;
  title: string;
  section: BlogSection;
  group: string;
  config?: GhConfig;
}): Promise<{ mdPath: string; slug: string; stalePaths: string[] }> {
  const config = opts.config ?? readGhConfig();
  const slug = slugFromTitle(opts.title, opts.sourceId);
  const slugPath = `website/${opts.section}/${opts.group}/${slug}.md`;
  const idRe = sourceIdLineRe(opts.sourceId);

  // 同分组内已有可读文件 → 继续写那份，避免标题微调改 URL
  const siblings = await listRepoDir(
    `website/${opts.section}/${opts.group}`,
    config,
  );
  for (const item of siblings) {
    if (item.type !== "file" || !item.name.endsWith(".md")) continue;
    if (item.name === `${opts.sourceId}.md`) continue;
    if (item.path === slugPath) {
      return {
        mdPath: slugPath,
        slug,
        stalePaths: await collectStaleArticlePaths({
          sourceId: opts.sourceId,
          section: opts.section,
          group: opts.group,
          preferredPath: slugPath,
          config,
        }),
      };
    }
    const text = await getRepoFileText(item.path, config);
    if (text && idRe.test(text)) {
      const existingSlug = item.name.replace(/\.md$/, "");
      return {
        mdPath: item.path,
        slug: existingSlug,
        stalePaths: await collectStaleArticlePaths({
          sourceId: opts.sourceId,
          section: opts.section,
          group: opts.group,
          preferredPath: item.path,
          config,
        }),
      };
    }
  }

  // 新文或仅有 id.md：落到标题 slug，并清理 id / sync 残留
  return {
    mdPath: slugPath,
    slug,
    stalePaths: await collectStaleArticlePaths({
      sourceId: opts.sourceId,
      section: opts.section,
      group: opts.group,
      preferredPath: slugPath,
      config,
    }),
  };
}

/** Recursive git tree: every website path ending with /{sourceId}.md */
async function findIdNamedMdPaths(
  sourceId: string,
  config: GhConfig,
): Promise<string[]> {
  const [owner, repo] = config.repo.split("/");
  if (!owner || !repo) return [];

  const branchRes = await githubRequest(
    config,
    "GET",
    `/repos/${owner}/${repo}/branches/${encodeURIComponent(config.branch)}`,
  );
  const commit = branchRes.json.commit as
    | { commit?: { tree?: { sha?: string } } }
    | undefined;
  const treeSha = commit?.commit?.tree?.sha;
  if (!branchRes.ok || !treeSha) return [];

  const treeRes = await githubRequest(
    config,
    "GET",
    `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`,
  );
  if (!treeRes.ok || !Array.isArray(treeRes.json.tree)) return [];

  const suffix = `/${sourceId}.md`;
  const out: string[] = [];
  for (const node of treeRes.json.tree as Array<Record<string, unknown>>) {
    if (node.type !== "blob" || typeof node.path !== "string") continue;
    if (!node.path.startsWith("website/")) continue;
    if (node.path.endsWith(suffix)) out.push(node.path);
  }
  return out;
}

function buildFrontmatter(fields: {
  title: string;
  date: string;
  summary?: string;
  tags: string[];
  section: BlogSection;
  group: string;
  sourceId: string;
  cover?: string | null;
  draft: boolean;
}): string {
  const lines = [
    "---",
    `title: ${yamlQuote(fields.title)}`,
    `date: ${fields.date}`,
  ];
  if (fields.summary) {
    lines.push(`summary: ${yamlQuote(fields.summary)}`);
  }
  if (fields.tags.length > 0) {
    lines.push("tags:");
    for (const tag of fields.tags) {
      lines.push(`  - ${yamlQuote(tag)}`);
    }
  } else {
    lines.push("tags: []");
  }
  lines.push(`section: ${fields.section}`);
  lines.push(`group: ${fields.group}`);
  lines.push("source: ai-article");
  lines.push(`sourceId: ${fields.sourceId}`);
  if (fields.cover) {
    lines.push(`cover: ${fields.cover}`);
  }
  lines.push(`draft: ${fields.draft ? "true" : "false"}`);
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

function buildArticleMeta(date: string, tags: string[]): string {
  const tagHtml = tags
    .slice(0, 4)
    .map((t) => `<span class="article-tag">${escapeHtml(t)}</span>`)
    .join("");
  return `<p class="article-meta"><time datetime="${date}">${date}</time>${tagHtml}</p>\n\n`;
}

/** 封面以 <img> 形式插入正文开头，penn-notes 主题没有 frontmatter cover 渲染 */
function buildCoverHtml(coverPath: string | null, title: string): string {
  if (!coverPath) return "";
  const alt = `「${title}」封面`;
  return `<img class="article-cover" src="${coverPath}" alt="${escapeHtml(alt)}" />\n\n`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function githubRequest(
  config: GhConfig,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let json: Record<string, unknown> = {};
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = { message: text.slice(0, 200) };
    }
  }

  return { ok: res.ok, status: res.status, json };
}

/** Delete a file via Contents API if it exists (ignore 404). */
export async function deleteFileIfExists(
  path: string,
  message: string,
  config = readGhConfig(),
): Promise<boolean> {
  const [owner, repo] = config.repo.split("/");
  if (!owner || !repo) return false;

  const encodedPath = path
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");

  const getRes = await githubRequest(
    config,
    "GET",
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`,
  );
  if (!getRes.ok || typeof getRes.json.sha !== "string") return false;

  const delRes = await githubRequest(
    config,
    "DELETE",
    `/repos/${owner}/${repo}/contents/${encodedPath}`,
    {
      message,
      sha: getRes.json.sha,
      branch: config.branch,
    },
  );
  return delRes.ok;
}

/** Upsert a text or binary file via Contents API. */
export async function upsertFile(
  path: string,
  content: string | Buffer,
  message: string,
  config = readGhConfig(),
): Promise<void> {
  const [owner, repo] = config.repo.split("/");
  if (!owner || !repo) {
    throw new Error(`BLOG_GITHUB_REPO 无效: ${config.repo}`);
  }

  const encodedPath = path
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");

  const getRes = await githubRequest(
    config,
    "GET",
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`,
  );

  let sha: string | undefined;
  if (getRes.ok && typeof getRes.json.sha === "string") {
    sha = getRes.json.sha;
  } else if (getRes.status !== 404) {
    const msg =
      typeof getRes.json.message === "string"
        ? getRes.json.message
        : `GitHub GET ${path} failed (${getRes.status})`;
    throw new Error(msg);
  }

  const contentBase64 =
    typeof content === "string"
      ? Buffer.from(content, "utf8").toString("base64")
      : content.toString("base64");

  const putRes = await githubRequest(
    config,
    "PUT",
    `/repos/${owner}/${repo}/contents/${encodedPath}`,
    {
      message,
      content: contentBase64,
      branch: config.branch,
      ...(sha ? { sha } : {}),
    },
  );

  if (!putRes.ok) {
    const msg =
      typeof putRes.json.message === "string"
        ? putRes.json.message
        : `GitHub PUT ${path} failed (${putRes.status})`;
    throw new Error(msg);
  }
}

export async function dispatchBlogSync(payload: {
  sourceId: string;
  path: string;
}, config = readGhConfig()): Promise<void> {
  const [owner, repo] = config.repo.split("/");
  if (!owner || !repo) {
    throw new Error(`BLOG_GITHUB_REPO 无效: ${config.repo}`);
  }

  const res = await githubRequest(
    config,
    "POST",
    `/repos/${owner}/${repo}/dispatches`,
    {
      event_type: "blog-sync",
      client_payload: {
        sourceId: payload.sourceId,
        path: payload.path,
      },
    },
  );

  // 204 No Content on success
  if (!res.ok && res.status !== 204) {
    const msg =
      typeof res.json.message === "string"
        ? res.json.message
        : `repository_dispatch failed (${res.status})`;
    throw new Error(msg);
  }
}

function defaultTags(article: BlogSyncArticle, override?: string[]): string[] {
  if (override && override.length > 0) {
    return override.map((t) => t.trim()).filter(Boolean);
  }
  if (!article.keywords) return [];
  return article.keywords
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}

async function uploadImages(
  articleId: string,
  html: string,
  coverUrl: string | null,
  config: GhConfig,
): Promise<{
  rewriteSrc: (src: string) => string | null;
  coverPath: string | null;
  commitPaths: string[];
}> {
  const map = new Map<string, string>();
  const commitPaths: string[] = [];
  let coverPath: string | null = null;
  let imgIndex = 0;

  const allSrcs = collectImageSrcs(html);

  for (const src of allSrcs) {
    try {
      // 只允许公开 http(s) 图片：拦截内网/本机地址，避免同步正文时服务端被诱导抓取内网资源（SSRF）
      let safeUrl: URL;
      try {
        safeUrl = assertSafeImportUrl(src);
      } catch {
        log.warn("blog-sync image skipped (unsafe url)", { src });
        continue;
      }

      const res = await fetchWithTimeout(
        safeUrl.href,
        {
          headers: { "User-Agent": "DraftlyBlogSync/1.0" },
        },
        IMAGE_FETCH_TIMEOUT_MS,
        "博客图片下载",
      );
      if (!res.ok) continue;

      const declaredLength = Number(res.headers.get("content-length") ?? "0");
      if (declaredLength > MAX_IMAGE_BYTES) continue;

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_IMAGE_BYTES) continue;

      const ext = guessImageExt(src, res.headers.get("content-type"));
      imgIndex += 1;
      const filename = `img-${imgIndex}.${ext}`;
      const repoPath = `website/public/sync/${articleId}/${filename}`;
      await upsertFile(repoPath, buf, `blog-sync: image ${articleId}/${filename}`, config);
      commitPaths.push(repoPath);
      // 必须写成 /sync/...（不含站点 base）。VitePress 构建时会按 base 改写；
      // 写成 /penn-notes/sync/... 会导致 Rollup 当成模块解析失败。
      map.set(src, `/sync/${articleId}/${filename}`);
    } catch (err) {
      log.error("blog-sync image upload failed", { src, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (coverUrl) {
    try {
      const buf = await downloadToBuffer(coverUrl);
      if (buf) {
        const ext = guessImageExt(coverUrl);
        const filename = `cover.${ext}`;
        const repoPath = `website/public/sync/${articleId}/${filename}`;
        await upsertFile(repoPath, buf, `blog-sync: cover ${articleId}`, config);
        commitPaths.push(repoPath);
        coverPath = `/sync/${articleId}/${filename}`;
        if (!map.has(coverUrl)) {
          map.set(coverUrl, coverPath);
        }
      }
    } catch (err) {
      log.error("blog-sync cover upload failed", { coverUrl, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    rewriteSrc: (src) => map.get(src) ?? null,
    coverPath,
    commitPaths,
  };
}

export async function syncArticleToBlog(
  article: BlogSyncArticle,
  options: BlogSyncOptions,
): Promise<BlogSyncResult> {
  if (!article.content?.trim()) {
    throw new Error("正文为空，无法同步到博客");
  }
  const title = (article.title ?? article.topic).trim();
  if (!title) {
    throw new Error("标题为空，无法同步到博客");
  }

  const tags = defaultTags(article, options.tags);
  const hintBlob = [
    ...tags,
    article.title ?? "",
    article.topic,
    article.keywords ?? "",
    article.summary ?? "",
  ];
  const inferred = inferBlogPlacement(hintBlob);
  const section =
    options.section && (BLOG_SECTIONS as readonly string[]).includes(options.section)
      ? options.section
      : inferred.section;
  if (options.section && !(BLOG_SECTIONS as readonly string[]).includes(options.section)) {
    throw new Error(`无效栏目 section: ${options.section}`);
  }

  const config = readGhConfig();
  const draft = options.draft === true;
  const group =
    options.group && isValidBlogGroup(section, options.group)
      ? options.group
      : inferBlogGroup(section, hintBlob);

  const safeContent = scrubSecretsForPublish(article.content);

  const { rewriteSrc, coverPath, commitPaths } = await uploadImages(
    article.id,
    safeContent,
    article.coverImageUrl,
    config,
  );

  const date = formatDate(
    article.createdAt instanceof Date ? article.createdAt : new Date(article.createdAt),
  );
  const bodyMd = htmlToBlogMarkdown(safeContent, { rewriteSrc });
  // 可读 slug；若仓库里已有同 sourceId 文件则复用其路径（稳定 URL）
  const { mdPath, slug, stalePaths } = await resolveArticleMdPath({
    sourceId: article.id,
    title,
    section,
    group,
    config,
  });

  const fm = buildFrontmatter({
    title,
    date,
    summary: article.summary?.trim() || undefined,
    tags,
    section,
    group,
    sourceId: article.id,
    cover: coverPath,
    draft,
  });

  // 与手写笔记一致：H1 标题 + meta + 封面，再跟正文
  const fileContent = `${fm}# ${title}\n\n${buildArticleMeta(date, tags)}${buildCoverHtml(coverPath, title)}${bodyMd}`;
  await upsertFile(
    mdPath,
    fileContent,
    `blog-sync: ${title} (${article.id})`,
    config,
  );
  commitPaths.push(mdPath);

  for (const stalePath of stalePaths) {
    const removed = await deleteFileIfExists(
      stalePath,
      `blog-sync: remove stale path for ${article.id}`,
      config,
    );
    if (removed) commitPaths.push(`deleted:${stalePath}`);
  }

  await dispatchBlogSync({ sourceId: article.id, path: mdPath }, config);

  const articleUrl = `${config.siteUrl}${section}/${group}/${slug}`;

  return {
    path: mdPath,
    url: articleUrl,
    coverPath,
    commitPaths,
  };
}
