import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { createCalendar, exchangeCode, refreshAccessToken } from "@/lib/calendar/google";
import { saveLink } from "@/lib/calendar/link";
import { STATE_COOKIE } from "@/lib/calendar/oauth-state";

export const runtime = "nodejs";
export const maxDuration = 30;

/** 専用カレンダーの名前。ユーザーのカレンダー一覧にこの名前で並ぶ */
const CALENDAR_NAME = "目標設定コーチ";

export async function GET(req: Request) {
  const denied = await requireAuthIfEnabled();
  if (denied) return denied;

  const url = new URL(req.url);
  const origin = url.origin;
  const fail = (why: string) =>
    NextResponse.redirect(new URL(`/settings?calendar=${why}`, origin));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  // 使い捨て。成否にかかわらず消す
  jar.delete(STATE_COOKIE);

  // 合言葉が一致しないものは、自分が始めた往復ではない
  if (!state || !expected || state !== expected) return fail("state");
  if (!code) return fail("denied");

  try {
    const { refreshToken } = await exchangeCode(code, `${origin}/api/calendar/callback`);
    const accessToken = await refreshAccessToken(refreshToken);
    const calendarId = await createCalendar(accessToken, CALENDAR_NAME);
    const ok = await saveLink({ refreshToken, calendarId });
    if (!ok) return fail("save");
    return NextResponse.redirect(new URL("/settings?calendar=connected", origin));
  } catch (err) {
    console.error("[calendar/callback]", err);
    return fail("error");
  }
}
