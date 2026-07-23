import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Enables src/instrumentation.ts (in-process job worker)
};

export default nextConfig;
