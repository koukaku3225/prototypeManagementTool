import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * マジックリンクの着地点。
 * メールのリンクには ?code=... が付いており、それをセッションへ交換する。
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
    // 原因切り分け用。落ち着いたら消す
    console.error("[auth/callback] exchange failed:", error.message, error.status, error.code);
  } else {
    console.error("[auth/callback] no code in URL:", url.toString());
  }

  return NextResponse.redirect(new URL("/login?error=1", url.origin));
}
