import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  await destroySession(token);

  const response = NextResponse.json({ code: 0, message: "ok", data: null });
  response.cookies.set({
    ...sessionCookieOptions(""),
    maxAge: 0,
  });
  return response;
}
