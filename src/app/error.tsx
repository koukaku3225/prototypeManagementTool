"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * 例外が漏れたときの画面。
 *
 * これが無いと Next.js の既定画面（英語）に落ちる。
 * このアプリは対話の途中で落ちることがありうるので、
 * 「何が起きたか」より「保存されているものは無事か」を先に伝える。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 対話の中身は出さない。エラーの識別子だけ残す
    console.error("[error boundary]", error.name, error.digest ?? "");
  }, [error]);

  return (
    <main className="phone flex flex-1 flex-col justify-center gap-5 px-5 py-14">
      <div>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">
          Error
        </p>
        <h1 className="mt-2 font-serif text-[22px] leading-[1.5] font-bold">
          うまく表示できませんでした
        </h1>
      </div>

      <p className="text-[14px] leading-relaxed text-muted">
        保存されている大きな物語・目標・対話の記録は、この画面のせいで
        消えることはありません。もう一度開き直すと直ることがあります。
      </p>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-xl bg-indigo px-4 py-3.5 text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          もう一度読み込む
        </button>
        <Link
          href="/"
          className="rounded-xl border border-line bg-surface px-4 py-3 text-center text-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ホームへ戻る
        </Link>
      </div>

      <p className="text-[12px] leading-relaxed text-muted">
        繰り返し出る場合は、設定画面から状態をJSONで書き出しておくと、
        原因を調べるときに役立ちます。
      </p>

      {error.digest && (
        <p className="font-mono text-[10.5px] text-muted">
          識別子: {error.digest}
        </p>
      )}
    </main>
  );
}
