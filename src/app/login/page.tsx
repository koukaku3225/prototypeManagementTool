"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * ログイン。
 *
 * パスワードは持たない（マジックリンクのみ）。個人用途で、
 * 覚える・漏らす・使い回す、というパスワードの弱点をまるごと避けられる。
 */
export default function LoginPage() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") ? "リンクが無効か、期限切れです。もう一度送ってください。" : null,
  );

  async function send() {
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${location.origin}/auth/callback`,
      },
    });
    setBusy(false);
    if (err) {
      setError("送信できませんでした。時間を置いてもう一度お試しください。");
      return;
    }
    setSent(true);
  }

  return (
    <>
      <AppHeader title="ログイン" />
      <main className="phone flex flex-1 flex-col justify-center px-5 py-10">
        {sent ? (
          <div className="rounded-xl border border-accent-line bg-accent-soft px-4 py-5 text-center">
            <p className="text-[14px] leading-relaxed text-accent">
              {email} 宛にログイン用のリンクを送りました。
              <br />
              メールを開いて、リンクを押してください。
            </p>
          </div>
        ) : (
          <>
            <h1 className="font-serif text-[22px] leading-[1.45] font-bold text-balance">
              メールでログイン
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              パスワードは使いません。入力したアドレスにログイン用のリンクを送ります。
            </p>

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-accent-line bg-accent-soft px-3.5 py-2.5 text-[12.5px] text-accent"
              >
                {error}
              </p>
            )}

            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="you@example.com"
              className="mt-4 min-h-12 w-full rounded-lg border border-line bg-surface px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
              aria-label="メールアドレス"
            />

            <button
              type="button"
              onClick={send}
              disabled={busy || !email.trim()}
              className="mt-3 min-h-13 rounded-xl bg-indigo px-4 text-[15px] font-medium text-surface disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {busy ? "送信中…" : "ログインリンクを送る"}
            </button>
          </>
        )}
      </main>
    </>
  );
}
