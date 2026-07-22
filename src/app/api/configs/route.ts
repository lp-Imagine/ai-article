import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/api-auth";
import { withUserConfig } from "@/lib/config-bridge";

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const configs = await db.appConfig.findMany({
    where: { userId: user.id },
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
  const user = await requireUser();
  if (user instanceof NextResponse) return user;

  const body = (await req.json()) as Record<string, string>;

  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string") continue;
    await db.appConfig.upsert({
      where: {
        userId_configKey: { userId: user.id, configKey: key },
      },
      create: { userId: user.id, configKey: key, configValue: value },
      update: { configValue: value },
    });
  }

  return withUserConfig(user.id, async () =>
    NextResponse.json({
      code: 0,
      message: "ok",
      data: null,
    }),
  );
}
