"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { HabitAddSheet } from "@/components/HabitAddSheet";
import { HabitCheck } from "@/components/HabitCheck";
import { HabitEditSheet } from "@/components/HabitEditSheet";
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
  const [adding, setAdding] = useState(false);
  // 習慣そのもの（名前・最小版・いつ・どこで）を直しているもの
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);

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

  // 習慣を足せるのは進行中の目標だけ（完了した目標の習慣は、どの画面にも出ない）
  const activeCards = useMemo(
    () => cards.filter((c) => (c.status ?? "active") !== "done"),
    [cards],
  );
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
    const message = cheerFor(state, computeStats(habit, nextLogs, day), habit.celebration);
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
              習慣は、長期目標のために繰り返すことです。「いつ・どこで・何をしたら」と、
              最小版を決めておくと続きやすくなります。
            </p>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="min-h-11 rounded-xl bg-indigo px-4 py-3 text-center text-[14px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              ＋ 習慣を足す
            </button>
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

            {/* 見直しの入口。月は1か月を1枚で見るだけの画面、週は数字を見て一言を書く画面 */}
            <nav aria-label="見直し" className="mt-4 grid grid-cols-2 gap-2">
              <Link
                href="/habits/month"
                className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="shrink-0 text-accent">
                  <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
                  <path d="M3.5 9.5h17M9 9.5v11M15 9.5v11M3.5 15h17" />
                </svg>
                <span className="min-w-0 flex-1 leading-tight">
                  月の見開き
                  <span className="block text-[11px] text-muted">1か月を1枚で</span>
                </span>
              </Link>
              <Link
                href="/habits/week"
                className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-accent">
                  <path d="M5 4.5h14v15H5z" />
                  <path d="M8.5 9h7M8.5 12.5h7M8.5 16h4" />
                </svg>
                <span className="min-w-0 flex-1 leading-tight">
                  週のふりかえり
                  <span className="block text-[11px] text-muted">一言を書く</span>
                </span>
              </Link>
            </nav>

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
                    <Item key={x.habit.id} label={labelOf(x.habit.cardId)} cardId={x.habit.cardId} onEdit={() => setEditingHabit(x.habit)}>
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
                      <Item key={x.habit.id} label={labelOf(x.habit.cardId)} cardId={x.habit.cardId} compact onEdit={() => setEditingHabit(x.habit)}>
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

            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mt-6 min-h-11 rounded-xl border border-dashed border-line text-[13px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              ＋ 習慣を足す
            </button>

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
                      <Item key={x.habit.id} label={labelOf(x.habit.cardId)} cardId={x.habit.cardId} compact onEdit={() => setEditingHabit(x.habit)}>
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

      {editingHabit && (
        <HabitEditSheet
          habit={editingHabit}
          onClose={() => {
            setEditingHabit(null);
            reload();
          }}
        />
      )}

      {adding && (
        <HabitAddSheet
          cards={activeCards}
          onClose={() => {
            setAdding(false);
            reload();
          }}
        />
      )}

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
  onEdit,
  children,
}: {
  label: string;
  cardId: string;
  compact?: boolean;
  /** 習慣そのものを直す。どの状態の習慣からも開けるようにする */
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <div className={`mb-1 flex items-center gap-2 px-0.5 ${compact ? "" : "mt-0.5"}`}>
        {label ? (
          <Link
            href={`/goal/${cardId}#sec-habit`}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-[11.5px] text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true">▸</span>
            <span className="truncate">{label}</span>
          </Link>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          onClick={onEdit}
          className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 text-[11.5px] text-muted hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11.5 2.5a1.7 1.7 0 0 1 2.4 2.4L5.4 13.4l-3.2.8.8-3.2 8.5-8.5Z" />
          </svg>
          習慣を直す
        </button>
      </div>
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
      <span className="shrink-0 text-[11px] text-muted">
        {STATE_LABEL[state]}
        <span aria-hidden="true"> ・ 直す ›</span>
      </span>
    </button>
  );
}
