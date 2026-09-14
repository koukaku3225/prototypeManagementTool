import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { createCalendar, exchangeCode, refreshAccessToken } from "@/lib/calendar/google";
import { currentUserId, saveLink } from "@/lib/calendar/link";
import { STATE_COOKIE, stateMatches } from "@/lib/calendar/oauth-state";

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

  // 合言葉が一致しない、または始めた利用者と今の利用者が違うものは、
  // この利用者が始めた往復ではない（途中でアカウントを切り替えた等）
  const userId = await currentUserId().catch(() => null);
  if (!stateMatches(expected, state, userId)) return fail("state");
  if (!code) return fail("denied");
  if (!userId) return fail("save");

  try {
    const { refreshToken } = await exchangeCode(code, `${origin}/api/calendar/callback`);
    const accessToken = await refreshAccessToken(refreshToken);
    const calendarId = await createCalendar(accessToken, CALENDAR_NAME);
    const ok = await saveLink({ refreshToken, calendarId, expectedUserId: userId });
    if (!ok) return fail("save");
    return NextResponse.redirect(new URL("/settings?calendar=connected", origin));
  } catch (err) {
    console.error("[calendar/callback]", err);
    return fail("error");
  }
}
