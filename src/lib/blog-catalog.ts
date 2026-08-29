/**
 * Penn Notes 栏目目录：优先从博客仓库 GitHub 目录结构拉取，
 * 失败时回退到本地 blog-sync-constants（避免博客改栏目后手工同步）。
 */
import {
  BLOG_SECTION_NAV_ORDER,
  BLOG_SECTIONS,
  SECTION_GROUPS,
  SECTION_LABELS,
  type BlogGroupOption,
  type BlogSection,
} from "@/lib/blog-sync-constants";
import { getEnvValue } from "@/lib/config-bridge";

export type BlogCatalogSection = {
  id: string;
  label: string;
  groups: BlogGroupOption[];
};

export type BlogCatalog = {
  source: "github" | "local";
  updatedAt: string;
  sections: BlogCatalogSection[];
};

const SKIP_WEBSITE_DIRS = new Set([
  "about",
  "archive",
  "news",
  "public",
  "sync",
  "tags",
  "img",
  ".vitepress",
]);

const GROUP_LABEL_FALLBACK: Record<string, string> = Object.fromEntries(
  Object.values(SECTION_GROUPS)
    .flat()
    .map((g) => [g.id, g.label]),
);

let cache: { catalog: BlogCatalog; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30 * 60 * 1000;

export function getLocalBlogCatalog(): BlogCatalog {
  const sections = BLOG_SECTION_NAV_ORDER.map((id) => ({
    id,
    label: SECTION_LABELS[id],
    groups: SECTION_GROUPS[id] ?? [{ id: "misc", label: "其它" }],
  }));
  return {
    source: "local",
    updatedAt: new Date(0).toISOString(),
    sections,
  };
}

function readGhAuth(): { token: string; repo: string; branch: string } | null {
  const token = (getEnvValue("BLOG_GITHUB_TOKEN") ?? process.env.BLOG_GITHUB_TOKEN ?? "").trim();
  const repo = (
    getEnvValue("BLOG_GITHUB_REPO") ??
    process.env.BLOG_GITHUB_REPO ??
    "lp-Imagine/penn-notes"
  ).trim();
  const branch = (
    getEnvValue("BLOG_GITHUB_BRANCH") ??
    process.env.BLOG_GITHUB_BRANCH ??
    "master"
  ).trim();
  if (!token || !repo.includes("/")) return null;
  return { token, repo, branch };
}

type GhContentItem = {
  name: string;
  type: "file" | "dir" | string;
  path: string;
};

async function listGithubDir(
  auth: { token: string; repo: string; branch: string },
  dirPath: string,
): Promise<GhContentItem[]> {
  const url = `https://api.github.com/repos/${auth.repo}/contents/${dirPath}?ref=${encodeURIComponent(auth.branch)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${auth.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "draftly-blog-catalog",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`GitHub 读取 ${dirPath} 失败: HTTP ${res.status}`);
  }
  const json = (await res.json()) as GhContentItem[] | { message?: string };
  if (!Array.isArray(json)) {
    throw new Error(`GitHub 读取 ${dirPath} 失败: ${json.message ?? "invalid response"}`);
  }
  return json;
}

function sectionLabel(id: string): string {
  if ((BLOG_SECTIONS as readonly string[]).includes(id)) {
    return SECTION_LABELS[id as BlogSection];
  }
  return id;
}

function groupLabel(id: string): string {
  return GROUP_LABEL_FALLBACK[id] ?? id;
}

function preferredSectionOrder(ids: string[]): string[] {
  const preferred = BLOG_SECTION_NAV_ORDER.filter((id) => ids.includes(id));
  const rest = ids.filter((id) => !preferred.includes(id as BlogSection)).sort();
  return [...preferred, ...rest];
}

async function fetchCatalogFromGithub(): Promise<BlogCatalog> {
  const auth = readGhAuth();
  if (!auth) throw new Error("未配置博客仓库 Token，无法拉取远程栏目");

  const root = await listGithubDir(auth, "website");
  const sectionIds = root
    .filter((item) => item.type === "dir" && !SKIP_WEBSITE_DIRS.has(item.name))
    .map((item) => item.name);

  const ordered = preferredSectionOrder(sectionIds);
  const sections: BlogCatalogSection[] = [];

  for (const sectionId of ordered) {
    const children = await listGithubDir(auth, `website/${sectionId}`);
    const groupIds = children
      .filter((item) => item.type === "dir")
      .map((item) => item.name)
      .sort((a, b) => {
        const local = SECTION_GROUPS[sectionId as BlogSection];
        if (!local) return a.localeCompare(b);
        const ai = local.findIndex((g) => g.id === a);
        const bi = local.findIndex((g) => g.id === b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });

    // 保证至少有「其它」，方便尚未建目录的文章先落盘
    if (!groupIds.includes("misc")) groupIds.push("misc");

    sections.push({
      id: sectionId,
      label: sectionLabel(sectionId),
      groups: groupIds.map((id) => ({ id, label: groupLabel(id) })),
    });
  }

  if (sections.length === 0) {
    throw new Error("远程仓库 website/ 下未发现栏目目录");
  }

  return {
    source: "github",
    updatedAt: new Date().toISOString(),
    sections,
  };
}

export async function getBlogCatalog(opts?: {
  forceRefresh?: boolean;
}): Promise<BlogCatalog> {
  if (!opts?.forceRefresh && cache && cache.expiresAt > Date.now()) {
    return cache.catalog;
  }

  try {
    const catalog = await fetchCatalogFromGithub();
    cache = { catalog, expiresAt: Date.now() + CACHE_TTL_MS };
    return catalog;
  } catch {
    const local = getLocalBlogCatalog();
    // 远程失败时短缓存本地，避免每次请求都打 GitHub
    cache = { catalog: local, expiresAt: Date.now() + 60_000 };
    return local;
  }
}

export function clearBlogCatalogCache() {
  cache = null;
}

export function isCatalogSection(catalog: BlogCatalog, section: string): boolean {
  return catalog.sections.some((s) => s.id === section);
}

export function isCatalogGroup(
  catalog: BlogCatalog,
  section: string,
  group: string,
): boolean {
  const sec = catalog.sections.find((s) => s.id === section);
  return Boolean(sec?.groups.some((g) => g.id === group));
}

export function catalogNavOrder(catalog: BlogCatalog): string[] {
  return catalog.sections.map((s) => s.id);
}

export function catalogSectionLabel(catalog: BlogCatalog, section: string): string {
  return catalog.sections.find((s) => s.id === section)?.label ?? section;
}

export function catalogGroups(
  catalog: BlogCatalog,
  section: string,
): BlogGroupOption[] {
  return (
    catalog.sections.find((s) => s.id === section)?.groups ?? [
      { id: "misc", label: "其它" },
    ]
  );
}
