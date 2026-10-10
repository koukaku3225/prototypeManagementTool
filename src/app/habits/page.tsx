"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { HabitCheck } from "@/components/HabitCheck";
import { Snackbar } from "@/components/Snackbar";
import { useDayRollover } from "@/hooks/useDayRollover";
import { today } from "@/lib/date";
import { goalCardLabel } from "@/lib/goal-card";
import { computeStats, scheduleLabel } from "@/lib/habit";
import { habitsOfActiveCards } from "@/lib/habit-plan";
import { cheerFor, logHabitState, splitTodayHabits, type HabitItem } from "@/lib/habit-today";
import {
  activeHabits,
  loadAllTimeBoxes,
  loadCards,
  loadHabitLogs,
  setHabitLog,
  upsertTimeBox,
} from "@/lib/storage";
import type { GoalCard } from "@/types/goal";
import type { Habit, HabitLog, HabitLogState } from "@/types/behavior";

/**
 * 習慣。
 *
 * 下タブの並びは「今日（カレンダー）→ 習慣 → 中間目標 → 目標」。
 * 毎日の細かい単位から、長期目標へ積み上がる順に置く。
 *
 * ここは習慣を「今日やる／記録した／今日は予定なし」に分けて出す。
 * 習慣は長期目標に直接つなぐ（中間目標にはぶら下げない）。どの目標のための
 * 習慣かは、各カードの目標名の札で分かるようにする。
 *
 * 記録の書き方は habit-today.ts。時刻つきの習慣は時間割の枠としても並ぶので、
 * 記録と枠を一緒に動かす（片方だけだと画面ごとに達成率が変わる）。
 */
export default function HabitsPage() {
  const [cards, setCards] = useState<GoalCard[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [day, setDay] = useState(today());
  const [ready, setReady] = useState(false);
  const [cheer, setCheer] = useState<{ message: string; key: number } | null>(null);
  // 記録済みの習慣は畳んで出す。押すと同じ4択が開いて、書き換えられる
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [showOff, setShowOff] = useState(false);

  const reload = useCallback(() => {
    const all = loadCards();
    setCards(all);
    // 完了した目標の習慣は、時間割・今日の画面と同じ基準で出さない
    setHabits(habitsOfActiveCards(activeHabits(), all));
    setLogs(loadHabitLogs());
    setDay(today());
  }, []);

  useEffect(() => {
    reload();
    setReady(true);
  }, [reload]);

  useDayRollover(() => reload());

  const split = useMemo(() => splitTodayHabits(habits, logs, day), [habits, logs, day]);
  const labelOf = useCallback(
    (cardId: string) => {
      const c = cards.find((x) => x.id === cardId);
      return c ? goalCardLabel(c) : "";
    },
    [cards],
  );

  function record(habit: Habit, state: HabitLogState, note: string | null) {
    logHabitState({
      habit,
      state,
      note,
      date: day,
      existing: loadAllTimeBoxes(),
      deps: {
        upsertTimeBox,
        setHabitLog,
        newId: () => crypto.randomUUID(),
        now: () => new Date().toISOString(),
      },
    });
    const nextLogs = loadHabitLogs();
    setLogs(nextLogs);
    // メモの追記（同じ状態の再送）では祝わない
    const before = logs.find((l) => l.habitId === habit.id && l.date === day);
    if (before?.state === state) return;
    const message = cheerFor(state, computeStats(habit, nextLogs, day));
    if (message) setCheer({ message, key: Date.now() });
  }

  if (!ready) {
    return (
      <>
        <AppHeader title="習慣" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  const total = split.open.length + split.logged.length;
  const doneCount = split.logged.filter(
    (x) => x.stats.todayLog?.state === "done" || x.stats.todayLog?.state === "partial",
  ).length;

  return (
    <>
      <AppHeader title="習慣" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        {habits.length === 0 ? (
          <section className="mt-6 flex flex-col gap-3">
            <h1 className="font-serif text-[22px] leading-[1.45] font-bold">
              まだ、習慣がありません
            </h1>
            <p className="text-[14px] leading-relaxed text-muted">
              習慣は、長期目標の詳細画面から足せます。「いつ・どこで・何をしたら」と、
              最小版を決めておくと続きやすくなります。
            </p>
            <Link
              href="/goals"
              className="min-h-11 rounded-xl border border-line bg-surface px-4 py-3 text-center text-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              目標を開く
            </Link>
          </section>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <h1 className="font-serif text-[20px] font-bold">今日の習慣</h1>
              <span className="ml-auto text-[12px] tabular-nums text-muted">
                {doneCount} / {total}
              </span>
            </div>
            {total > 0 && (
              <div
                className="mt-2 h-1.5 overflow-hidden rounded bg-surface-2"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={doneCount}
                aria-label="今日の習慣の進み具合"
              >
                <div
                  className="h-full rounded bg-indigo"
                  style={{ width: `${Math.round((doneCount / total) * 100)}%` }}
                />
              </div>
            )}

            {/* 残り：未記録を大きく。ここだけが「やること」 */}
            <section className="mt-4" aria-label="今日やる習慣">
              {split.open.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-[13px] leading-relaxed text-muted">
                  {total === 0
                    ? "今日やる習慣はありません。"
                    : "今日のぶんは、すべて記録しました。"}
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {split.open.map((x) => (
                    <Item key={x.habit.id} label={labelOf(x.habit.cardId)} cardId={x.habit.cardId}>
                      <HabitCheck
                        habit={x.habit}
                        stats={x.stats}
                        onLog={(s, n) => record(x.habit, s, n)}
                      />
                    </Item>
                  ))}
                </ul>
              )}
            </section>

            {/* 記録した：1行に畳む。押すと開いて、書き換えられる */}
            {split.logged.length > 0 && (
              <section className="mt-6" aria-label="今日の記録">
                <h2 className="mb-1.5 px-0.5 text-[12px] text-muted">今日の記録</h2>
                <ul className="flex flex-col gap-2">
                  {split.logged.map((x) => {
                    const open = openIds.has(x.habit.id);
                    return (
                      <Item key={x.habit.id} label={labelOf(x.habit.cardId)} cardId={x.habit.cardId} compact>
                        {open ? (
                          <HabitCheck
                            habit={x.habit}
                            stats={x.stats}
                            onLog={(s, n) => record(x.habit, s, n)}
                          />
                        ) : (
                          <LoggedRow
                            item={x}
                            onOpen={() => setOpenIds(new Set(openIds).add(x.habit.id))}
                          />
                        )}
                      </Item>
                    );
                  })}
                </ul>
              </section>
            )}

            {/* 今日は予定なし：曜日が合わない習慣。閉じておく */}
            {split.off.length > 0 && (
              <section className="mt-6" aria-label="今日は予定のない習慣">
                <button
                  type="button"
                  onClick={() => setShowOff((v) => !v)}
                  aria-expanded={showOff}
                  className="min-h-11 w-full rounded-xl border border-dashed border-line px-3 text-left text-[12.5px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  今日は予定のない習慣（{split.off.length}）
                  <span className="float-right" aria-hidden="true">
                    {showOff ? "▲" : "▼"}
                  </span>
                </button>
                {showOff && (
                  <ul className="mt-2 flex flex-col gap-2">
                    {split.off.map((x) => (
                      <Item key={x.habit.id} label={labelOf(x.habit.cardId)} cardId={x.habit.cardId} compact>
                        <div className="rounded-xl border border-line bg-surface px-3 py-2.5">
                          <p className="text-[13.5px]">{x.habit.title}</p>
                          <p className="mt-0.5 font-mono text-[11px] text-muted">
                            {scheduleLabel(x.habit)}
                          </p>
                        </div>
                      </Item>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </main>

      {cheer && (
        <Snackbar
          key={cheer.key}
          message={cheer.message}
          ms={2600}
          onDismiss={() => setCheer(null)}
        />
      )}
    </>
  );
}

/** 目標名の札つきの1件。札を押すと、その目標の習慣の欄へ飛ぶ */
function Item({
  label,
  cardId,
  compact,
  children,
}: {
  label: string;
  cardId: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li>
      {label && (
        <Link
          href={`/goal/${cardId}#sec-habit`}
          className={`mb-1 flex items-center gap-1.5 px-0.5 text-[11.5px] text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            compact ? "" : "mt-0.5"
          }`}
        >
          <span aria-hidden="true">▸</span>
          <span className="truncate">{label}</span>
        </Link>
      )}
      {children}
    </li>
  );
}

const STATE_LABEL: Record<HabitLogState, string> = {
  done: "やった",
  partial: "最小版でやった",
  skipped: "今日は休み",
  missed: "できなかった",
};

function LoggedRow({ item, onOpen }: { item: HabitItem; onOpen: () => void }) {
  const state = item.stats.todayLog?.state ?? "done";
  const ok = state === "done" || state === "partial";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${item.habit.title}（${STATE_LABEL[state]}）。押すと記録を書き換えられます`}
      className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        ok ? "border-accent-line bg-accent-soft" : "border-line bg-surface"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
          ok ? "border-accent bg-accent text-surface" : "border-line text-muted"
        }`}
      >
        {state === "done" ? "✓" : state === "partial" ? "–" : state === "skipped" ? "休" : "×"}
      </span>
      <span className={`min-w-0 flex-1 truncate text-[13.5px] ${ok ? "" : "text-muted"}`}>
        {item.habit.title}
      </span>
      <span className="shrink-0 text-[11px] text-muted">{STATE_LABEL[state]}</span>
    </button>
  );
}
