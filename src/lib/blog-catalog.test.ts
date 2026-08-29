import { describe, expect, it } from "vitest";
import {
  catalogGroups,
  getLocalBlogCatalog,
  isCatalogGroup,
  isCatalogSection,
} from "./blog-catalog";

describe("blog-catalog", () => {
  it("local catalog includes engineering and backend", () => {
    const catalog = getLocalBlogCatalog();
    expect(catalog.source).toBe("local");
    expect(isCatalogSection(catalog, "engineering")).toBe(true);
    expect(isCatalogSection(catalog, "backend")).toBe(true);
    expect(isCatalogGroup(catalog, "engineering", "git")).toBe(true);
    expect(isCatalogGroup(catalog, "backend", "nodejs")).toBe(true);
    expect(catalogGroups(catalog, "tech").map((g) => g.id)).toContain("github");
  });
});
