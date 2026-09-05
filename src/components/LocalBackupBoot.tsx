"use client";

import { useEffect, useRef, useState } from "react";
import {
  captureState,
  hasUserContent,
  restoreState,
  setLocalBackupHook,
} from "@/lib/storage";

/**
 * ローカルディスクへの自動バックアップと、空っぽ起動時の復元案内。
 *
 * localStorage が丸ごと消える事故が実際に起きた。原因は特定できていないが、
 * ブラウザの中に置く安全網（スナップショット・JSON書き出し）はどれも
 * 同じ弱点を持つ（サイトデータの一括削除に巻き込まれる）。
 * ここは /api/local-backup 経由でこのPCのディスクに書くので、
 * ブラウザ側で何が起きても残る。ログインの有無は関係ない。
 */
const DEBOUNCE_MS = 4000;

/**
 * この安全網が意味を持つのは、サーバーが自分のPCで動いているときだけ。
 *
 * デプロイ後のサーバーレス環境ではディスクが永続しないので、
 * 書き込みは必ず 500 で失敗する。それでも毎回叩いていたため、
 * 保存のたびに「対話全文を含む状態まるごと」を本番へ送っては捨てていた
 * （無駄な転送・無駄な関数実行・ログの汚染）。動く場所でだけ動かす。
 */
function isLocalHost(): boolean {
  if (typeof location === "undefined") return false;
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

export function LocalBackupBoot() {
  const timer = useRef<number | null>(null);
  const [offer, setOffer] = useState<Record<string, string> | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isLocalHost()) return;
    // まとめて送る。1文字打つたびに書き込むと無駄が多い
    const push = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        const snap = captureState();
        fetch("/api/local-backup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snap),
        }).catch(() => {
          /* 書けなくても致命的ではない。localStorage 側は保存済み */
        });
      }, DEBOUNCE_MS);
    };

    setLocalBackupHook(push);
    return () => {
      setLocalBackupHook(null);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  // 起動時、いま何もないのにディスク側にバックアップがあれば申し出る
  useEffect(() => {
    if (!isLocalHost()) return;
    if (hasUserContent(captureState())) return;
    fetch("/api/local-backup")
      .then((r) => r.json())
      .then((res: { ok: boolean; data: Record<string, string> | null }) => {
        if (res.ok && res.data && hasUserContent(res.data)) setOffer(res.data);
      })
      .catch(() => {
        /* 無ければ何も出さない */
      });
  }, []);

  if (!offer || dismissed) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 border-b border-accent bg-accent-soft px-5 py-3"
    >
      <div className="phone flex items-start gap-3">
        <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-accent">
          <strong className="block font-medium">
            このブラウザにデータがありません。
          </strong>
          このPCに残っているバックアップから復元できます。
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={restoring}
            onClick={() => {
              setRestoring(true);
              const ok = restoreState(offer);
              setRestoring(false);
              if (ok) {
                setOffer(null);
                location.reload();
              }
            }}
            className="rounded-md border border-accent-line bg-surface px-2.5 py-1 text-[11.5px] text-accent disabled:opacity-50"
          >
            {restoring ? "復元中…" : "復元する"}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="この案内を閉じる"
            className="rounded-md border border-accent-line px-2.5 py-1 text-[11.5px] text-accent"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
