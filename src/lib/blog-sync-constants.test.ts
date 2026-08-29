import { describe, expect, it } from "vitest";
import {
  BLOG_SECTION_NAV_ORDER,
  BLOG_SECTIONS,
  SECTION_GROUPS,
  SECTION_LABELS,
  inferBlogGroup,
  inferBlogPlacement,
  inferBlogSection,
} from "./blog-sync-constants";

describe("blog section catalog", () => {
  it("includes engineering and backend and matches penn-notes nav order", () => {
    expect([...BLOG_SECTIONS]).toEqual([
      "web",
      "ui",
      "engineering",
      "backend",
      "tech",
      "computer",
      "agent",
      "misc",
    ]);
    expect(BLOG_SECTION_NAV_ORDER).toEqual([
      "web",
      "ui",
      "engineering",
      "backend",
      "tech",
      "agent",
      "computer",
      "misc",
    ]);
    expect(SECTION_LABELS.engineering).toBe("工程化");
    expect(SECTION_LABELS.backend).toBe("后端");
    expect(SECTION_GROUPS.engineering.map((g) => g.id)).toEqual([
      "git",
      "npm",
      "toolchain",
      "misc",
    ]);
    expect(SECTION_GROUPS.backend.map((g) => g.id)).toEqual(["nodejs", "mysql", "misc"]);
    expect(SECTION_GROUPS.tech.map((g) => g.id)).toEqual([
      "docs",
      "github",
      "bookmarks",
      "misc",
    ]);
  });
});

describe("inferBlogPlacement", () => {
  it("routes AI model selection articles to agent", () => {
    const placed = inferBlogPlacement([
      "模型更快更贵，该怎么选",
      "模型迭代越来越快，但更快不等于更划算。这份指南从业务 SLO、延迟、吞吐、价格与基准测试出发，帮工程师把选型从感觉变成可复现的对比。",
    ]);
    expect(placed.section).toBe("agent");
    expect(["practice", "tools", "workflow", "prompts"]).toContain(placed.group);
  });

  it("routes Vue tips to web/vue", () => {
    const placed = inferBlogPlacement(["Vue 组件常用选项", "Vue"]);
    expect(placed.section).toBe("web");
    expect(placed.group).toBe("vue");
  });

  it("routes CSS layout to ui/css", () => {
    expect(inferBlogSection(["CSS Flex 布局完全指南"])).toBe("ui");
    expect(inferBlogGroup("ui", ["CSS Flex 布局"])).toBe("css");
  });

  it("routes browser extension to computer", () => {
    const placed = inferBlogPlacement(["Chrome Extension 开发入门"]);
    expect(placed.section).toBe("computer");
    expect(placed.group).toBe("browser");
  });

  it("routes git docs to engineering/git", () => {
    const placed = inferBlogPlacement(["Git 常用命令备忘"]);
    expect(placed.section).toBe("engineering");
    expect(placed.group).toBe("git");
  });

  it("routes npm docs to engineering/npm", () => {
    const placed = inferBlogPlacement(["npm 常用命令", "package.json"]);
    expect(placed.section).toBe("engineering");
    expect(placed.group).toBe("npm");
  });

  it("routes MySQL notes to backend/mysql", () => {
    const placed = inferBlogPlacement(["MySQL 数据库常用操作"]);
    expect(placed.section).toBe("backend");
    expect(placed.group).toBe("mysql");
  });

  it("routes Node.js notes to backend/nodejs", () => {
    const placed = inferBlogPlacement(["nodejs 递归读取所有文件", "Node.js"]);
    expect(placed.section).toBe("backend");
    expect(placed.group).toBe("nodejs");
  });

  it("routes GitHub tips to tech/github", () => {
    const placed = inferBlogPlacement(["GitHub 高级搜索技巧", "GitHub"]);
    expect(placed.section).toBe("tech");
    expect(placed.group).toBe("github");
  });
});
