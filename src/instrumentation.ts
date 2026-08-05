export async function register() {
  // 仅在 Node.js runtime 启动调度器（Edge runtime 没有 setInterval/db）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSchedulerStarted } = await import("@/lib/scheduler");
    ensureSchedulerStarted();
  }
}
