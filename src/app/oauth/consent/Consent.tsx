"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase/client";
import { safeOAuthRedirect } from "./redirect";

export default function Consent({ authorizationId, clientIds }: { authorizationId: string; clientIds: string[] }) {
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [email, setEmail] = useState("");
  const [loggedOut, setLoggedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [redirect, setRedirect] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const returnTo = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(""); setDetails(null); setRedirect(null); setLoggedOut(false);
      try {
        if (!authorizationId) throw new Error("missing request");
        const auth = supabaseBrowser().auth;
        const { data: account, error: accountError } = await auth.getUser();
        if (!active) return;
        if (accountError) throw accountError;
        if (!account.user) { setLoggedOut(true); return; }
        setEmail(account.user.email ?? account.user.id);
        const { data, error: requestError } = await auth.oauth.getAuthorizationDetails(authorizationId);
        if (requestError || !data) throw requestError;
        if (!active) return;
        if ("redirect_url" in data) {
          const target = safeOAuthRedirect(data.redirect_url);
          if (!target) throw new Error("invalid redirect");
          setRedirect(target);
        } else {
          if (data.user.id !== account.user.id || data.authorization_id !== authorizationId) throw new Error("account mismatch");
          setDetails(data);
        }
      } catch {
        if (active) setError("連携リクエストを確認できませんでした。再試行するか、連携先から接続をやり直してください。");
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [authorizationId, attempt]);

  async function decide(approve: boolean) {
    if (busy || !details || (approve && !clientIds.includes(details.client.id))) return;
    setBusy(true); setError("");
    try {
      const auth = supabaseBrowser().auth;
      const { data: account, error: accountError } = await auth.getUser();
      if (accountError || account.user?.id !== details.user.id) throw new Error("account changed");
      const { data, error: decisionError } = approve
        ? await auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (decisionError || !data) throw decisionError;
      const target = safeOAuthRedirect(data.redirect_url);
      if (!target) throw new Error("invalid redirect");
      window.location.assign(target);
    } catch {
      setError("処理を完了できませんでした。アカウントやリクエストの期限を確認し、再試行してください。");
      setBusy(false);
    }
  }

  return <main className="phone space-y-5 px-5 py-10 text-sm leading-relaxed">
    <h1 className="text-xl font-bold">外部AIとの連携を許可</h1>
    {loading ? <p role="status">連携リクエストを確認中…</p> : null}
    {loggedOut ? <><p>記録を共有するアカウントでログインしてください。</p><Link className="text-accent underline" href={`/login?next=${encodeURIComponent(returnTo)}`}>ログインして続ける</Link></> : null}
    {email ? <p>現在のアカウント：<strong className="break-all">{email}</strong></p> : null}
    {error ? <div role="alert"><p>{error}</p><button type="button" disabled={busy} className="mt-2 min-h-11 underline" onClick={() => setAttempt(a => a + 1)}>再読み込み</button></div> : null}
    {redirect ? <><p>このリクエストはすでに許可されています。</p><a href={redirect} className="text-accent underline">連携先へ戻る</a></> : null}
    {details ? <>
      <section className="rounded-xl border border-line bg-surface p-4"><h2 className="font-bold break-all">{details.client.name || "連携アプリ"}</h2><p className="break-all">クライアントID：{details.client.id}</p><p className="break-all">登録サイト：{details.client.uri || "登録なし"}</p><p className="break-all">認証の要求範囲：{details.scope || "指定なし"}</p></section>
      <section><h2 className="font-bold">共有する記録（読み取り専用）</h2><ul className="list-disc pl-5"><li>現在の目標・期限・価値観、大きな物語のビジョンと価値観</li><li>習慣の名前・最小版・実施状態・メモ・気分</li><li>時間割の予定時刻・タイトル・完了記録・振り返り</li></ul><p className="mt-3">対話全文や過去の挫折は共有しません。連携先から記録を追加・変更・削除することはできません。</p></section>
      <p>クラウドに同期済みの記録だけが対象です。この端末の未同期データは取得できません。共有した内容は連携先のAIサービスで処理されます。</p>
      {!clientIds.includes(details.client.id) ? <p role="alert">この連携アプリは許可対象に登録されていません。</p> : null}
      <div className="flex gap-3"><button type="button" disabled={busy || !clientIds.includes(details.client.id)} onClick={() => void decide(true)} className="min-h-12 flex-1 rounded-xl bg-indigo px-4 text-surface disabled:opacity-50">{busy ? "処理中…" : "読み取りを許可"}</button><button type="button" disabled={busy} onClick={() => void decide(false)} className="min-h-12 rounded-xl border border-line px-5 disabled:opacity-50">拒否</button></div>
    </> : null}
    <Link className="inline-block text-accent underline" href="/settings/connections">連携の確認・解除</Link>
  </main>;
}
