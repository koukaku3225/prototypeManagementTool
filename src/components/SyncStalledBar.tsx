"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getLastSyncError,
  getSyncState,
  onSyncError,
  onSyncState,
  type SyncState,
} from "@/lib/supabase/sync";

/**
 * クラウドへの保存が止まっていることを、どの画面にいても知らせる帯。
 *
 * 「端末とクラウドの両方に中身があり、まだ突き合わせていない」ときは、
 * どちらが正しいか機械的に決められないので、本人が選ぶまで
 * クラウドへの保存を止めている（sync.ts の conflict）。これ自体は
 * データを守るために正しい。
 *
 * ところが、その案内を設定画面にしか出していなかった。日常的に開くのは
 * 時間割で、設定はめったに開かない。結果、同期が止まっていることに
 * 気づけないまま1日分の予定を入力し続ける、という実害が出た
 * （別の端末で見たら何も無い、という形で発覚した）。
 *
 * 安全に止めること自体は正しくても、止まったことが伝わらなければ
 * 黙って壊れているのと変わらない。だからここはアプリ全体に出す。
 */
export function SyncStalledBar() {
  const [state, setState] = useState<SyncState>({ kind: "off" });
  const [error, setError] = useState<{ at: string; message: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setState(getSyncState());
    setError(getLastSyncError());
    const offState = onSyncState(setState);
    const offError = onSyncError(setError);
    return () => {
      offState();
      offError();
    };
  }, []);

  /*
   * 出すのは「本人が動かないと直らない状態」だけに絞る。
   * checking / pulling / pushing は放っておけば終わるので出さない。
   * off（未ログイン）も、同期しないことを選んでいるだけなので出さない。
   *
   * 状態が ready でも、個々の保存が失敗し続けることがある
   * （実際に timeboxes だけ弾かれ続けていた）。状態だけを見ていると
   * これを取りこぼすので、直近の失敗も同じ重さで扱う。
   */
  const stalled =
    state.kind === "conflict" || state.kind === "failed" || error !== null;
  if (!stalled || dismissed) return null;

  const conflict = state.kind === "conflict";

  return (
    <div
      role="status"
      className="sticky top-0 z-50 border-b border-accent bg-accent-soft px-5 py-3"
    >
      <div className="phone flex items-start gap-3">
        <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-accent">
          <strong className="block font-medium">
            クラウドへの保存が止まっています。
          </strong>
          {conflict
            ? "この端末とクラウドの両方に中身があるため、どちらを残すか決まるまで止めています。いまの入力は、この端末にだけ残っています。"
            : "いまの入力は、この端末にだけ残っています。別の端末では見られません。"}
          {/* 原因が読めないと直しようがないので、そのまま出す */}
          {!conflict && error && (
            <span className="mt-1 block break-all font-mono text-[11px] opacity-80">
              {error.message}
            </span>
          )}
        </span>
        <div className="flex shrink-0 flex-col gap-1.5">
          <Link
            href="/settings"
            className="rounded-md border border-accent-line bg-surface px-2.5 py-1 text-center text-[11.5px] text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            設定で直す
          </Link>
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
