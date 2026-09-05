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
  /*
   * ?error=1 は auth/callback からのリダイレクトで、原因はひとまとめに
   * されてしまう（コード交換の失敗理由をURLで安全に伝える手段がないため）。
   * ただし実際に踏んだ不具合の大半は「リンクをリクエストした端末と
   * 開いた端末が違う」ケースだったので、そちらを先に疑う文言にする。
   * メール自体は本人しか受け取れないので、単なる第三者によるアクセス試行の
   * 可能性は低いという前提。
   */
  const [error, setError] = useState<string | null>(
    params.get("error")
      ? "リンクを開けませんでした。よくある原因は次の2つです。①リンクをリクエストしたのと別の端末・別のブラウザで開いた ②時間が経って期限切れになった。同じ端末・同じブラウザで、届いてすぐに開き直してください。"
      : null,
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

  /**
   * Googleでログイン。
   *
   * メールリンクには「リクエストした端末と開く端末が違うと失敗する」という
   * 弱点がある（PKCEの制約。実際に確認したことがある不具合）。
   * OAuthはその場でブラウザが遷移して1回で完結するので、この弱点が
   * 原理的に起きない。メールリンクを置き換えるのではなく、選べる形で足す。
   */
  async function withGoogle() {
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback`,
      },
    });
    // 成功時はここで別ドメインへ遷移するので、busyを戻す必要はない。
    // 戻すのは失敗したときだけ
    if (err) {
      setBusy(false);
      setError("Googleログインを開始できませんでした。もう一度お試しください。");
    }
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
              ログイン
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              パスワードは使いません。Googleアカウントか、メールのリンクでログインできます。
            </p>

            <button
              type="button"
              onClick={withGoogle}
              disabled={busy}
              className="mt-4 flex min-h-13 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 text-[15px] font-medium disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.87 2.68-6.62Z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.87-3.04.87-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.97 10.73A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.19.28-1.73V4.94H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.06l3.01-2.33Z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
                />
              </svg>
              Googleでログイン
            </button>

            <div className="mt-5 flex items-center gap-3 text-[11.5px] text-muted">
              <span className="h-px flex-1 bg-line" />
              または
              <span className="h-px flex-1 bg-line" />
            </div>

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
