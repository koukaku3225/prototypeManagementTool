"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { OAuthGrant } from "@supabase/supabase-js";
import { AppHeader } from "@/components/AppHeader";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function ConnectionsPage() {
  const [grants, setGrants] = useState<OAuthGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    setLoading(true); setError("");
    const { data, error: loadError } = await supabaseBrowser().auth.oauth.listGrants();
    if (loadError) setError("連携情報を取得できませんでした。ログイン状態とOAuth設定を確認してください。");
    else setGrants(data ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function revoke(clientId: string) {
    setBusy(clientId); setError("");
    const { error: revokeError } = await supabaseBrowser().auth.oauth.revokeGrant({ clientId });
    if (revokeError) setError("連携を解除できませんでした。もう一度お試しください。");
    else await load();
    setBusy("");
  }

  return <>
    <AppHeader title="外部AIとの連携" />
    <main className="phone space-y-4 px-5 py-6 text-sm leading-relaxed">
      <p>ChatGPTやClaudeに許可した連携を確認・解除できます。</p>
      <p className="text-muted">解除すると更新用トークンは無効になります。発行済みの短時間トークンは、有効期限まで利用できる場合があります。</p>
      {loading ? <p role="status">確認中…</p> : null}
      {error ? <div role="alert"><p>{error}</p><button className="mt-2 min-h-11 underline" type="button" onClick={() => void load()}>再読み込み</button></div> : null}
      {!loading && !error && grants.length === 0 ? <p>許可中の連携はありません。</p> : null}
      {grants.map((grant) => <section key={grant.client.id} className="rounded-xl border border-line bg-surface p-4">
        <h2 className="font-bold break-all">{grant.client.name || "連携アプリ"}</h2>
        <p className="mt-1 text-muted break-all">許可範囲：{grant.scopes.join(" ") || "指定なし"}</p>
        <p className="text-muted">許可日：{new Date(grant.granted_at).toLocaleString("ja-JP")}</p>
        <button type="button" disabled={busy === grant.client.id} onClick={() => void revoke(grant.client.id)} className="mt-3 min-h-11 rounded-lg border border-line px-4 disabled:opacity-50">
          {busy === grant.client.id ? "解除中…" : "連携を解除"}
        </button>
      </section>)}
      <Link href="/settings" className="inline-block underline">設定へ戻る</Link>
    </main>
  </>;
}
