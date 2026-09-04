"use client";

import { useEffect, useState } from "react";
import { humanDuration } from "@/lib/timebox";
import type { GoalCard } from "@/types/goal";
import type { RunningEntry } from "@/types/timebox";

/**
 * 走っている打刻の帯。
 *
 * 時間割は「先に決める」道具なので、計画しなかった日は開く理由が消える。
 * こちらは押して始めて、終わったら止めるだけ。計画がゼロでも記録が残る。
 *
 * 走っている最中にやることと目標を書けるようにしてあるのは、
 * 始める前に入力を求めると「1タップで始める」が成立しないため。
 * 押してから、手が空いたときに書けばよい。
 */
export function RunningBar({
  entry,
  cards,
  onChange,
  onStop,
  onCancel,
}: {
  entry: RunningEntry;
  cards: GoalCard[];
  onChange: (over: Partial<Omit<RunningEntry, "startedAt">>) => void;
  onStop: () => void;
  onCancel: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => {
    const tick = () => {
      const ms = Date.now() - Date.parse(entry.startedAt);
      setElapsed(Math.max(0, Math.floor(ms / 60_000)));
    };
    tick();
    // 分単位でしか出さないので、秒まで追う必要はない
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [entry.startedAt]);

  const startedAt = new Date(entry.startedAt).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      data-below-grid
      role="status"
      aria-live="polite"
      style={{ bottom: "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom))" }}
      className="sticky z-20 border-t border-accent bg-accent-soft px-5 py-3"
    >
      <div className="phone">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-accent">
            記録中
          </span>
          <span className="font-mono text-[11px] text-muted">{startedAt}〜</span>
          <span className="ml-auto font-mono text-[13px] font-medium text-accent">
            {humanDuration(elapsed)}
          </span>
        </div>

        {/* 走らせたまま書ける。始める前に入力を求めない */}
        <input
          type="text"
          value={entry.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="何をしている？"
          maxLength={120}
          aria-label="いまやっていること"
          className="mt-2 min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-[14.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
        />

        {cards.length > 0 && (
          <select
            value={entry.cardId ?? ""}
            onChange={(e) => onChange({ cardId: e.target.value || null })}
            aria-label="紐づける目標"
            className="mt-2 min-h-11 w-full rounded-lg border border-line bg-paper px-3 text-[13.5px]"
          >
            <option value="">（目標に紐づけない）</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.vision.refined || c.vision.raw || "（未記入の目標）"}
              </option>
            ))}
          </select>
        )}

        {confirmCancel ? (
          <div className="mt-2 rounded-lg border border-line bg-paper px-3 py-2.5">
            <p className="text-[12.5px] leading-relaxed">
              記録せずに破棄します。ここまでの{humanDuration(elapsed)}は残りません。
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmCancel(false);
                  onCancel();
                }}
                className="min-h-11 flex-1 rounded-lg border border-accent-line bg-accent-soft px-3 text-[13px] text-accent"
              >
                破棄する
              </button>
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="min-h-11 flex-1 rounded-lg border border-line px-3 text-[13px] text-muted"
              >
                やめる
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onStop}
              className="min-h-11 flex-1 rounded-lg bg-indigo px-3 text-[14px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              止めて記録する
            </button>
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="min-h-11 rounded-lg border border-line bg-paper px-4 text-[13px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              破棄
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
