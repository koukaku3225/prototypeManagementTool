"use client";

import { useEffect, useState } from "react";

export const THINKING_MS = 10 * 60_000;

/**
 * 理想を考えるための時間。
 *
 * 以前あった60秒の強制ロックとは別物にしてある。あれは「勝手に待たされる」
 * ので苛立ちの原因になった。こちらはボタンをいつでも押せる。
 * タイマーは急かすためではなく、じっくり考えてよいと伝えるために置いている。
 */
export function ThinkingTimer({
  startedAt,
  onDone,
}: {
  startedAt: number;
  onDone: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const leftMs = Math.max(0, startedAt + THINKING_MS - now);
  const over = leftMs === 0;
  const mm = Math.floor(leftMs / 60_000);
  const ss = Math.floor((leftMs % 60_000) / 1000);
  const ratio = 1 - leftMs / THINKING_MS;

  return (
    <section className="rounded-xl border border-accent-line bg-accent-soft px-4 py-4">
      <p className="text-[13px] leading-relaxed">
        10分ほど、静かな場所で考えてみましょう。
        <br />
        まとまったら、下のボタンを押してください。
      </p>

      <div className="mt-3 flex items-center gap-3">
        <span
          className="font-mono text-[26px] tabular-nums leading-none"
          role="timer"
          aria-live="off"
        >
          {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
        </span>
        <span className="text-[11.5px] text-muted">
          {over ? "時間になりました" : "残り"}
        </span>
      </div>

      <div
        className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-label="考える時間の経過"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>

      <button
        type="button"
        onClick={onDone}
        className="mt-3.5 w-full rounded-lg bg-indigo px-4 py-2.5 text-[14px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {over ? "考えました。次へ進む" : "考えがまとまった"}
      </button>

      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        途中で押しても構いません。時間はあくまで目安です。
      </p>
    </section>
  );
}
