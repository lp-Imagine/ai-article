import { NextResponse } from "next/server";
import { requireUser, withAuthUserConfig } from "@/lib/api-auth";
import { getEnvValue } from "@/lib/config-bridge";

const DEFAULT_REPO = "lp-Imagine/vuepressblog";
const DEFAULT_BRANCH = "master";

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  return withAuthUserConfig(user, async () => {
    const token =
      getEnvValue("BLOG_GITHUB_TOKEN") ?? process.env.BLOG_GITHUB_TOKEN ?? "";
    const repo =
      getEnvValue("BLOG_GITHUB_REPO") ??
      process.env.BLOG_GITHUB_REPO ??
      DEFAULT_REPO;
    const branch =
      getEnvValue("BLOG_GITHUB_BRANCH") ??
      process.env.BLOG_GITHUB_BRANCH ??
      DEFAULT_BRANCH;
    const siteUrl =
      getEnvValue("BLOG_SITE_URL") ??
      process.env.BLOG_SITE_URL ??
      "";

    if (!token) {
      return NextResponse.json({
        code: 0,
        message: "missing BLOG_GITHUB_TOKEN",
        data: {
          configured: false,
          repo,
          branch,
          siteUrl,
          error: "请先填写 GitHub Token",
        },
      });
    }

    const [owner, name] = repo.split("/");
    if (!owner || !name) {
      return NextResponse.json({
        code: 0,
        message: "invalid repo",
        data: {
          configured: true,
          repo,
          branch,
          siteUrl,
          error: `仓库格式应为 owner/repo，当前：${repo}`,
        },
      });
    }

    try {
      // 轻量校验：拉一次仓库元数据，验证 token 对该仓库有读权限。
      const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (res.status === 401) {
        return NextResponse.json({
          code: 0,
          message: "unauthorized",
          data: {
            configured: true,
            repo,
            branch,
            siteUrl,
            httpStatus: 401,
            error: "Token 无效或已过期",
          },
        });
      }
      if (res.status === 404) {
        return NextResponse.json({
          code: 0,
          message: "repo not found",
          data: {
            configured: true,
            repo,
            branch,
            siteUrl,
            httpStatus: 404,
            error: `找不到仓库 ${repo}，请确认 Token 是否对该仓库有访问权限`,
          },
        });
      }
      if (!res.ok) {
        const body = await res.text();
        return NextResponse.json({
          code: 0,
          message: "ping failed",
          data: {
            configured: true,
            repo,
            branch,
            siteUrl,
            httpStatus: res.status,
            error: body.slice(0, 200) || `HTTP ${res.status}`,
          },
        });
      }

      const json = (await res.json()) as { default_branch?: string; permissions?: Record<string, boolean> };
      const perms = json.permissions ?? {};
      const hasWrite = Boolean(perms.push || perms.maintain || perms.admin);
      return NextResponse.json({
        code: 0,
        message: "ok",
        data: {
          configured: true,
          repo,
          branch,
          siteUrl,
          defaultBranch: json.default_branch ?? branch,
          permissions: perms,
          note: hasWrite
            ? "Token 对该仓库有写入权限"
            : "Token 已连接，但似乎没有 contents:write 权限，同步会失败",
        },
      });
    } catch (err) {
      return NextResponse.json({
        code: 0,
        message: "ping error",
        data: {
          configured: true,
          repo,
          branch,
          siteUrl,
          error: err instanceof Error ? err.message : "unknown",
        },
      });
    }
  });
}
