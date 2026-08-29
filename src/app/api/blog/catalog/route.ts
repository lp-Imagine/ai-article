import { NextResponse } from "next/server";
import { requireSuperAdmin, withAuthUserConfig } from "@/lib/api-auth";
import {
  clearBlogCatalogCache,
  getBlogCatalog,
  getLocalBlogCatalog,
} from "@/lib/blog-catalog";

/**
 * 拉取 Penn Notes 栏目目录（管理员）。
 * ?refresh=1 强制从 GitHub 重新扫描 website/ 目录结构。
 */
export async function GET(req: Request) {
  const user = await requireSuperAdmin();
  if (user instanceof NextResponse) return user;

  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  return withAuthUserConfig(user, async () => {
    try {
      if (forceRefresh) clearBlogCatalogCache();
      const catalog = await getBlogCatalog({ forceRefresh });
      return NextResponse.json({
        code: 0,
        message: "ok",
        data: catalog,
      });
    } catch (err) {
      const local = getLocalBlogCatalog();
      return NextResponse.json({
        code: 0,
        message: err instanceof Error ? err.message : "已回退本地栏目",
        data: local,
      });
    }
  });
}
