export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobWorker } = await import("@/lib/jobs/worker");
    startJobWorker();
  }
}
