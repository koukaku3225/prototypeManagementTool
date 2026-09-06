"use client";

import { useEffect, useState } from "react";

interface CalendarStatus {
  connected: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  // /api/calendar/status が通信障害等で状態を確認できなかった印。
  // これが true のときは「未連携」と断定せず、確認できなかった旨を出す
  // （でないと、実際は連携済みなのに誤って未連携と案内してしまう）。
  unknown?: boolean;
}

/**
 * 設定画面のGoogleカレンダー連携。
 *
 * 本人がやることは「ボタンを押して同意する」だけにする。
 * カレンダーの作成も初回同期もサーバー側で済ませるので、
 * IDの入力もコピペも発生しない。
 */
export function CalendarLink() {
  const [state, setState] = useState<CalendarStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [disconnectFailed, setDisconnectFailed] = useState(false);

  useEffect(() => {
    fetch("/api/calendar/status")
      .then((r) => r.json())
      .then(setState)
      .catch(() =>
        // fetch自体が失敗した場合も「確認できなかった」として扱う
        setState({ connected: false, lastSyncedAt: null, lastError: null, unknown: true }),
      );
  }, []);

  if (!state) {
    return <p className="mt-3 text-[12.5px] text-muted">確認中…</p>;
  }

  if (!state.connected) {
    return (
      <>
        {state.unknown ? (
          <p className="mt-1.5 text-[12px] leading-relaxed text-accent">
            連携状態を確認できませんでした。時間をおいて開き直してください。
          </p>
        ) : (
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            連携すると「目標設定コーチ」という専用カレンダーが作られ、時間割の予定と
            タイトル・時間が双方向に同期されます。ほかのカレンダーには触れません。
          </p>
        )}
        <a
          href="/api/calendar/connect"
          className="mt-3 flex min-h-11 items-center justify-center rounded-lg bg-indigo px-3 text-[13.5px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Googleカレンダーと連携する
        </a>
      </>
    );
  }

  return (
    <>
      <p className="mt-3 rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
        連携しています
        {state.lastSyncedAt &&
          `（最終同期 ${new Date(state.lastSyncedAt).toLocaleString("ja-JP")}）`}
      </p>
      {state.lastError && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-accent">
          直近のエラー: {state.lastError}
        </p>
      )}
      {disconnectFailed && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-accent">
          解除できませんでした。時間をおいてもう一度お試しください。
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setDisconnectFailed(false);
          try {
            const r = await fetch("/api/calendar/disconnect", { method: "POST" });
            const body = (await r.json()) as { ok: boolean };
            // deleteLink が失敗を返した場合、「解除しました」と偽るわけにはいかない。
            // 連携中のまま表示を維持し、失敗した旨だけ伝える。
            if (body.ok) {
              setState({ connected: false, lastSyncedAt: null, lastError: null });
            } else {
              setDisconnectFailed(true);
            }
          } catch {
            setDisconnectFailed(true);
          } finally {
            setBusy(false);
          }
        }}
        className="mt-3 min-h-11 rounded-lg border border-line bg-paper px-3 text-[13px] text-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        連携を解除する
      </button>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
        解除しても、カレンダー側の予定は消しません。
      </p>
    </>
  );
}
