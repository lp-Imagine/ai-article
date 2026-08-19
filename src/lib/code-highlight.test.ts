import { describe, expect, it } from "vitest";
import {
  highlightedCodeToPlainText,
  renderCodeBlockForWechat,
  resolveLanguageLabel,
} from "./code-highlight";

describe("resolveLanguageLabel（终端命令识别）", () => {
  it("identifies npx / npm commands as Bash, not CSS", () => {
    expect(
      resolveLanguageLabel("npx ts-migrate migrate --decorators --transforms experimentalDecorators --suffix .ts --src src"),
    ).toBe("Bash");
    expect(resolveLanguageLabel("npm run lint")).toBe("Bash");
    expect(resolveLanguageLabel("pnpm install && pnpm dev")).toBe("Bash");
  });

  it("identifies git / docker / curl pipelines as Bash", () => {
    expect(resolveLanguageLabel("git checkout -b feat/x && git push origin feat/x")).toBe("Bash");
    expect(resolveLanguageLabel("docker run -d --name milvus -p 19530:19530 milvusdb/milvus:v2.4")).toBe("Bash");
    expect(resolveLanguageLabel("curl -s https://api.example.com/v1/chat | jq .")).toBe("Bash");
  });

  it("keeps explicit language hints for non-shell code", () => {
    // 显式 language-css 的真实 CSS 代码仍识别为 CSS
    expect(resolveLanguageLabel("body { color: #333; } .btn { padding: 8px 16px; }", "css")).toBe("CSS");
    // 显式 language-python 的 Python 代码仍识别为 Python
    expect(resolveLanguageLabel("def check(data):\n    return data", "python")).toBe("Python");
  });

  it("does not misclassify YAML key-value or plain prose as shell", () => {
    expect(resolveLanguageLabel("cd: /opt/data", "yaml")).toBe("YAML");
    expect(resolveLanguageLabel("hello world", "plaintext")).toBe("Plain Text");
  });

  it("identifies python code without hint", () => {
    expect(
      resolveLanguageLabel(
        "import re\ndef check_format(data):\n    return re.match(r'^OD\\d{12}$', data)",
      ),
    ).toBe("Python");
  });
});

describe("renderCodeBlockForWechat（微信代码块）", () => {
  it("keeps long lines in a horizontally scrollable container (nowrap + overflow:auto)", () => {
    const html = renderCodeBlockForWechat(
      "npx ts-migrate migrate --decorators --transforms experimentalDecorators --suffix .ts --src src",
    );

    expect(html).toContain("white-space:nowrap");
    expect(html).toContain("overflow-x:auto");
    expect(html).toContain("-webkit-overflow-scrolling:touch");
    expect(html).not.toContain("white-space:pre-wrap");
    expect(html).not.toContain("max-height:420px");
    expect(html).toMatch(/data-mp-cb-lang="1"[^>]*>Bash<\/p>/);
  });

  it("renders a placeholder for empty code instead of a bare black box", () => {
    const html = renderCodeBlockForWechat("   ");

    expect(html).toContain("此处无代码内容");
  });

  it("preserves code text (indentation moves to padding-left in WeChat mode)", () => {
    const code = "const a = 1;\nif (a > 0) {\n  console.log(a);\n}\n";
    const rendered = renderCodeBlockForWechat(code);
    const inner = rendered.match(/data-mp-cb-body="1"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? "";

    // 微信模式下缩进用 padding-left 呈现（文本被 trim），逐行比对去掉行首空白后的内容
    const plain = highlightedCodeToPlainText(inner)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const expected = code
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(plain).toEqual(expected);
  });

  it("escapes < > & in code so they are not parsed as HTML tags", () => {
    const code = "if len(user_id) < 10:\n    return '<div>' in html and a & b";
    const rendered = renderCodeBlockForWechat(code);

    // 输出中不允许出现裸的 < >（会被微信/浏览器当标签解析，导致 DOM 错乱、内容移位重复）
    const body = rendered.match(/data-mp-cb-body="1"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? "";
    expect(body).not.toMatch(/<(?![a-zA-Z\/!])/);
    expect(body).not.toMatch(/<div/);
    expect(body).toContain("&lt;div&gt;");
    expect(body).toContain("&lt;");
    expect(body).toContain("&amp;");
    // 还原后仍是原代码（逐行忽略缩进：微信模式缩进走 padding-left）
    const plain = highlightedCodeToPlainText(body)
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const expected = code
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(plain).toEqual(expected);
  });
});
