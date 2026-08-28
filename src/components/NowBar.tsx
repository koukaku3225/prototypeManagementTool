"use client";

import { durationMin, humanDuration, toMinutes } from "@/lib/timebox";
import type { TimeBox } from "@/types/timebox";

/**
 * いま何の時間かを、画面の下に出し続ける。
 *
 * 時間割を作っても、その時間になったときに画面を見ていなければ意味がない。
 * ここが「いま、これをやる時間です」と言い続ける役をする。
 *
 * 進行中がなければ、直前に迫っている予定を出す。
 * 何も無いときは出さない（無いことを知らせても仕方がない）。
 */
export function NowBar({
  current,
  next,
  nowMinutes,
  onComplete,
  onEdit,
}: {
  current: TimeBox | null;
  next: TimeBox | null;
  nowMinutes: number;
  onComplete: (box: TimeBox) => void;
  onEdit: (box: TimeBox) => void;
}) {
  const box = current ?? next;
  if (!box) return null;

  const running = current !== null;
  const start = toMinutes(box.start) ?? 0;
  const end = toMinutes(box.end) ?? 0;
  const done = Boolean(box.completedAt);

  return (
    <div
      role="status"
      aria-live="polite"
      data-below-grid
      style={{ bottom: "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))" }}
      className={`sticky z-20 border-t px-5 py-3 ${
        running
          ? "border-accent bg-accent-soft"
          : "border-line bg-surface"
      }`}
    >
      <div className="phone">
        <div className="flex items-baseline gap-2">
          <span
            className={`font-mono text-[10.5px] uppercase tracking-[0.14em] ${
              running ? "text-accent" : "text-muted"
            }`}
          >
            {running ? "いまの時間" : `${start - nowMinutes}分後`}
          </span>
          <span className="font-mono text-[11px] text-muted">
            {box.start}〜{box.end}
          </span>
          {running && (
            <span className="ml-auto font-mono text-[11px] text-muted">
              残り{humanDuration(Math.max(0, end - nowMinutes))}
            </span>
          )}
          {!running && (
            <span className="ml-auto font-mono text-[11px] text-muted">
              {humanDuration(durationMin(box))}
            </span>
          )}
        </div>

        <p
          className={`mt-1 text-[15px] leading-snug font-medium ${
            done ? "text-muted line-through" : ""
          }`}
        >
          {box.title || "（未記入）"}
        </p>

        {/* 対策は、その時間になってから読むためにここへ出す */}
        {running && !done && box.meta.counter && (
          <p className="mt-1 text-[12.5px] leading-relaxed text-accent">
            対策: {box.meta.counter}
          </p>
        )}

        <div className="mt-2 flex gap-2">
          {!done && (
            <button
              type="button"
              onClick={() => onComplete(box)}
              className="min-h-11 flex-1 rounded-lg bg-indigo px-3 text-[14px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              完了
            </button>
          )}
          <button
            type="button"
            onClick={() => onEdit(box)}
            className={`min-h-11 rounded-lg border border-line bg-paper px-4 text-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              done ? "flex-1" : ""
            }`}
          >
            {done ? "振り返りを書く" : "編集"}
          </button>
        </div>
      </div>
    </div>
  );
}
