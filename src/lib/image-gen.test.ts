import { describe, expect, it } from "vitest";
import {
  clampImageSize,
  parseImageSize,
  resolveImageSize,
} from "./image-gen";

describe("parseImageSize", () => {
  it("parses x and * separators", () => {
    expect(parseImageSize("2048x1152")).toEqual({ width: 2048, height: 1152 });
    expect(parseImageSize("2048*1152")).toEqual({ width: 2048, height: 1152 });
  });
});

describe("clampImageSize", () => {
  it("downscales width beyond qwen limit", () => {
    const clamped = clampImageSize(2560, 1440);
    expect(clamped.width).toBeLessThanOrEqual(2048);
    expect(clamped.height).toBeLessThanOrEqual(2048);
    expect(clamped.width % 16).toBe(0);
    expect(clamped.height % 16).toBe(0);
  });
});

describe("resolveImageSize", () => {
  it("uses max valid cover size for qwen-image models", () => {
    expect(resolveImageSize("cover", "qwen-image-2.0")).toBe("2048*1152");
  });

  it("uses landscape inline size for qwen-image models", () => {
    expect(resolveImageSize("inline", "qwen-image-2.0")).toBe("2048*1152");
  });

  it("uses dalle-3 sizes", () => {
    expect(resolveImageSize("cover", "dall-e-3")).toBe("1792x1024");
    expect(resolveImageSize("inline", "dall-e-3")).toBe("1792x1024");
  });

  it("uses seedream 2K landscape for cover and inline", () => {
    expect(resolveImageSize("cover", "doubao-seedream-4-5-251128")).toBe("2848x1600");
    expect(resolveImageSize("inline", "doubao-seedream-4-5-251128")).toBe("2848x1600");
  });

  it("uses seedream 5.x landscape within 4M pixel cap", () => {
    expect(resolveImageSize("inline", "seedream-5-0-pro")).toBe("2560x1440");
  });
});
