"use client";

import Link from "next/link";
import type { TodayCheckpoint } from "@/lib/checkpoint";
import { goalCardLabel } from "@/lib/goal-card";
import type { GoalCard } from "@/types/goal";

/**
 * 今日の画面の先頭に出す、いまの中間目標（R19、2026-09-14）。
 *
 * 目標の詳細を開かないと中間目標が見えず、「期限が近づいたときに
 * 今なにをやるべきか迷わない」という狙いが日々の画面に届いていなかった。
 * どれを出すかは checkpoint.ts の todayCheckpoints が決める（最大2件）。
 * 1件も無ければ何も描かない。見出しだけの空欄は作らない。
 */
export function TodayCheckpoints({
  shown,
  rest,
  cards,
}: {
  shown: TodayCheckpoint[];
  rest: number;
  cards: GoalCard[];
}) {
  if (shown.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
        いまの中間目標
      </h2>
      <ul className="mt-2 flex flex-col gap-2">
        {shown.map(({ checkpoint: c, over, left }) => {
          const card = cards.find((x) => x.id === c.cardId);
          return (
            <li key={c.id}>
              <Link
                href="/checkpoints"
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  over ? "border-accent-line bg-accent-soft" : "border-line bg-surface"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="shrink-0 rounded-md border border-line bg-paper px-1.5 py-0.5 font-mono text-[10.5px] text-muted"
                >
                  {c.period.kind === "week" ? "週" : "月"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">
                    {/* 期限切れは「今週」ではない。読み上げで取り違えさせない */}
                    <span className="sr-only">
                      {over
                        ? `期間が終わった${c.period.kind === "week" ? "週" : "月"}の中間目標：`
                        : c.period.kind === "week"
                          ? "今週："
                          : "今月："}
                    </span>
                    {c.title}
                  </span>
                  {card && (
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {goalCardLabel(card)}
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 text-right font-mono text-[11px] ${over ? "text-accent" : "text-muted"}`}
                >
                  {over ? (
                    <>
                      期間が終わりました
                      <br />
                      振り返る →
                    </>
                  ) : (
                    `残り${left}日`
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {rest > 0 && (
        <Link
          href="/checkpoints"
          className="mt-1.5 inline-block text-[12px] text-muted underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ほか{rest}件 →
        </Link>
      )}
    </section>
  );
}
