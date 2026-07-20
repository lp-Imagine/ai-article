import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncConfigsToEnv } from "@/lib/config-bridge";

export async function GET() {
  const configs = await db.appConfig.findMany({
    orderBy: { configKey: "asc" },
  });

  const map: Record<string, string> = {};
  for (const cfg of configs) {
    map[cfg.configKey] = cfg.configValue;
  }

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: map,
  });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Record<string, string>;

  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string") continue;
    await db.appConfig.upsert({
      where: { configKey: key },
      create: { configKey: key, configValue: value },
      update: { configValue: value },
    });
  }

  await syncConfigsToEnv();

  return NextResponse.json({
    code: 0,
    message: "ok",
    data: null,
  });
}