import { describe, expect, it } from "vitest";
import {
  inferBlogGroup,
  inferBlogPlacement,
  inferBlogSection,
} from "./blog-sync-constants";

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

  it("routes git docs to tech", () => {
    const placed = inferBlogPlacement(["Git 常用命令备忘", "npm"]);
    expect(placed.section).toBe("tech");
  });
});
