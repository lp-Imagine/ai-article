import { describe, expect, it } from "vitest";
import { analyzeContentQuality } from "./content-quality";

describe("analyzeContentQuality", () => {
  it("flags AI cliches and chatty openers", () => {
    const result = analyzeContentQuality({
      title: "认知升级指南",
      summary: "在当今时代，赋能与闭环很重要",
      content: `
        <p>上周和一个朋友聊天，他说最近在学习上花了很多时间，进展却不大。我听完觉得方向对但顺序要调整。</p>
        <p>众所周知，底层逻辑决定了颗粒度。我们需要打造闭环，沉淀方法论，实现认知升级。</p>
        <p>值得注意的是，关键在于体系化。真正的问题是赋能抓手还不够。</p>
        <p>归根结底，只要持续优化、不断迭代、坚持长期主义，就能小步快跑。</p>
      `,
    });

    expect(result.issues.some((i) => i.code === "ai_cliche")).toBe(true);
    expect(result.issues.some((i) => i.code === "chatty_opener")).toBe(true);
    expect(result.score).toBeLessThan(75);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("scores concrete hands-on content higher", () => {
    const result = analyzeContentQuality({
      title: "上传组件：先定 API 再写队列",
      summary: "先定 props，再写并发池与进度计算，附可粘贴代码。",
      content: `
        <p>封装上传组件时，先把对外契约写死：<code>accept</code>、<code>maxSize</code>、<code>concurrent</code>，再补内部队列。</p>
        <p>例如并发设为 3 时，队列里第 4 个任务必须等任一 slot 释放；进度用「已完成分片 / 总分片」而不是假动画。</p>
        <pre><code>async function runPool(tasks, concurrent) {
  const executing = new Set();
  for (const task of tasks) {
    const p = Promise.resolve().then(task).finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= concurrent) await Promise.race(executing);
  }
  await Promise.all(executing);
}</code></pre>
        <p>弱网场景：监听 <code>offline</code> 后暂停队列，恢复时从失败分片重试，而不是整文件重传。</p>
        <h2>总结</h2>
        <div class="mp-summary"><p>今天就改一处：把进度改成真实分片比，或把并发池抽成独立函数。</p></div>
      `,
    });

    expect(result.issues.some((i) => i.code === "chatty_opener")).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("flags engineering topic without code", () => {
    const result = analyzeContentQuality({
      title: "React 组件封装实战",
      summary: "讲讲如何封装上传组件与接口设计",
      content: `
        <p>封装组件时要注意边界和可维护性。首先要理解本质，其次要体系化思考接口设计。</p>
        <p>很多人只会堆功能，却不知道真正的问题是架构。我们需要持续优化，不断迭代。</p>
        <p>什么是好的封装？它的重要性不言而喻。注意事项也很多。总结与展望：未来会更好。</p>
        <p>方法论决定上限。关键在于对齐认知，打造闭环。赋能业务才是抓手。</p>
        <p>如果你也觉得难，不如先从理念开始。归根结底还是态度问题，方向对了就好。</p>
        <p>最后别忘了长期主义。小步快跑，持续优化，不断迭代，就会越来越好。</p>
        <p>所谓组件封装，本质上是认知问题。我们要对齐颗粒度，沉淀方法论，打造完整闭环。</p>
        <p>在这个时代，接口设计决定了上限。只要坚持体系化，就能实现真正的认知升级。</p>
      `,
    });

    expect(result.issues.some((i) => i.code === "missing_hands_on")).toBe(true);
    expect(result.issues.some((i) => i.code === "homogeneous_skeleton")).toBe(true);
  });
});
