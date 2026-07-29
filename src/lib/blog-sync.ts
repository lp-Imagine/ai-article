/**
 * Sync Draftly articles to vuepressblog via GitHub Contents API + repository_dispatch.
 * Contract: vuepressblog/docs/SYNC.md
 */
import { downloadToBuffer } from "@/lib/image-gen";
import {
  collectImageSrcs,
  guessImageExt,
  htmlToBlogMarkdown,
} from "@/lib/html-to-blog-md";
import { BLOG_SECTIONS, type BlogSection, inferBlogGroup, isValidBlogGroup } from "@/lib/blog-sync-constants";
import { getEnvValue } from "@/lib/config-bridge";

export { BLOG_SECTIONS, type BlogSection };

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
  section: BlogSection;
  /** 侧栏分组，如 javascript / css / docs */
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
      const res = await fetch(src);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
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
      console.error(`[blog-sync] image upload failed: ${src}`, err);
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
      console.error(`[blog-sync] cover upload failed: ${coverUrl}`, err);
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
  if (!BLOG_SECTIONS.includes(options.section)) {
    throw new Error(`无效栏目 section: ${options.section}`);
  }

  const config = readGhConfig();
  const draft = options.draft === true;
  const tags = defaultTags(article, options.tags);
  const group =
    options.group && isValidBlogGroup(options.section, options.group)
      ? options.group
      : inferBlogGroup(options.section, [
          ...tags,
          article.title ?? "",
          article.topic,
          article.keywords ?? "",
        ]);

  const { rewriteSrc, coverPath, commitPaths } = await uploadImages(
    article.id,
    article.content,
    article.coverImageUrl,
    config,
  );

  const date = formatDate(
    article.createdAt instanceof Date ? article.createdAt : new Date(article.createdAt),
  );
  const bodyMd = htmlToBlogMarkdown(article.content, { rewriteSrc });
  // 写入正式栏目路径，才能匹配 VitePress 侧栏 `/web/` 等前缀
  const mdPath = `website/${options.section}/${group}/${article.id}.md`;
  const legacyPaths = [
    `website/sync/${options.section}/${group}/${article.id}.md`,
    `website/sync/${options.section}/${article.id}.md`,
  ];

  const fm = buildFrontmatter({
    title,
    date,
    summary: article.summary?.trim() || undefined,
    tags,
    section: options.section,
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

  for (const legacyPath of legacyPaths) {
    const removed = await deleteFileIfExists(
      legacyPath,
      `blog-sync: remove legacy path for ${article.id}`,
      config,
    );
    if (removed) commitPaths.push(`deleted:${legacyPath}`);
  }

  await dispatchBlogSync({ sourceId: article.id, path: mdPath }, config);

  const articleUrl = `${config.siteUrl}${options.section}/${group}/${article.id}`;

  return {
    path: mdPath,
    url: articleUrl,
    coverPath,
    commitPaths,
  };
}
