import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { CALENDAR_SCOPE } from "@/lib/calendar/google";
import { encodeStateCookie, STATE_COOKIE } from "@/lib/calendar/oauth-state";
import { currentUserId } from "@/lib/calendar/link";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(req: Request) {
  const denied = await requireAuthIfEnabled();
  if (denied) return denied;

  const origin = new URL(req.url).origin;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/settings?calendar=misconfigured", origin));
  }

  // 戻ってきたときに「自分が始めた往復か」を確かめるための合言葉
  const state = crypto.randomUUID();
  const jar = await cookies();
  // 始めた利用者も一緒に覚える。戻ってきたときに別人なら保存しない
  jar.set(STATE_COOKIE, encodeStateCookie(state, await currentUserId().catch(() => null)), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/calendar/callback`,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    // refresh_token をもらうために必須。無いと1時間で切れて終わる
    access_type: "offline",
    // 2回目以降の連携でも確実に refresh_token を返させる
    prompt: "consent",
    state,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}
