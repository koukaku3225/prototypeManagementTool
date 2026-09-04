"use client";

import { dueLabel } from "@/lib/date";
import type { HabitLogState } from "@/types/behavior";

/**
 * 実施状況の格子。
 *
 * 数字（達成率 72%）だけだと、良いのか悪いのか本人にも分からない。
 * 並べて見ると「どのあたりで崩れたか」が形で分かる。
 *
 * 始めて2週間は出さない（呼び出し側で判断する）。
 * 空っぽの格子は「まだ何もしていない」という情報しか持たず、
 * 続ける気を削ぐだけなので。
 */
const COLOR: Record<HabitLogState, string> = {
  done: "bg-accent",
  partial: "bg-accent/45",
  skipped: "bg-line",
  missed: "bg-surface-2 border border-line",
};

export function Heatmap({
  cells,
  label,
}: {
  cells: { date: string; state: HabitLogState | null; scheduled: boolean }[];
  label?: string;
}) {
  return (
    <div>
      {label && (
        <p className="mb-1.5 font-mono text-[10.5px] text-muted">{label}</p>
      )}
      {/* 7列＝1週間が1行になる。曜日の癖が縦に並んで見える */}
      <div className="grid grid-cols-7 gap-1" role="img" aria-label={describe(cells)}>
        {cells.map((c) => (
          <span
            key={c.date}
            title={`${dueLabel(c.date)} ${stateLabel(c.state, c.scheduled)}`}
            className={`aspect-square rounded-[3px] ${
              c.state
                ? COLOR[c.state]
                : c.scheduled
                  ? "bg-surface-2 border border-line"
                  : "bg-transparent border border-line-soft"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

function stateLabel(state: HabitLogState | null, scheduled: boolean): string {
  if (state === "done") return "できた";
  if (state === "partial") return "最小版";
  if (state === "skipped") return "休み";
  if (state === "missed") return "できなかった";
  return scheduled ? "記録なし" : "予定なし";
}

/** 読み上げ用。格子を1つずつ読ませても意味がないので要約する */
function describe(
  cells: { state: HabitLogState | null; scheduled: boolean }[],
): string {
  const done = cells.filter(
    (c) => c.state === "done" || c.state === "partial",
  ).length;
  const scheduled = cells.filter((c) => c.scheduled && c.state !== "skipped").length;
  return `直近${cells.length}日のうち、予定${scheduled}日に対して${done}日できています`;
}
