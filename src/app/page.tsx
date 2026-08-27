"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { HabitCheck } from "@/components/HabitCheck";
import {
  activeHabits,
  loadCards,
  loadHabitLogs,
  loadSession,
  setHabitLog,
  upsertCard,
} from "@/lib/storage";
import { computeStats } from "@/lib/habit";
import { dueLabel, isDueBy, isOverdue, toLocalDate, today } from "@/lib/date";
import type { GoalCard, Task } from "@/types/goal";
import type { Habit, HabitLog, HabitLogState } from "@/types/behavior";

/**
 * 今日。
 *
 * 起動して最初に出る画面で、ここだけが「続けるモード」に属する。
 * 決めた内容（大きな物語・目標の全項目）は［目標］タブへ移した。
 * 毎日1〜3回・15〜60秒・移動中に片手で触る、という前提で作る。
 *
 * 出すものは3つだけ。今日の一歩 / 今日の習慣 / 今日やったこと。
 * 「まだ先の予定」は件数しか出さない。今日やらないものを並べると、
 * 毎朝どれから手を付けるかを決め直すことになる。
 */
export default function TodayPage() {
  const [cards, setCards] = useState<GoalCard[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [resumable, setResumable] = useState(false);
  const [ready, setReady] = useState(false);

  const reload = useCallback(() => {
    setCards(loadCards());
    setHabits(activeHabits());
    setLogs(loadHabitLogs());
  }, []);

  useEffect(() => {
    reload();
    const s = loadSession();
    setResumable(Boolean(s && !s.completedAt && s.messages.length > 0));
    setReady(true);
  }, [reload]);

  function toggleTask(cardId: string, taskId: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    upsertCard({
      ...card,
      updatedAt: new Date().toISOString(),
      tasks: card.tasks.map((t) =>
        t.id === taskId
          ? { ...t, completedAt: t.completedAt ? null : new Date().toISOString() }
          : t,
      ),
    });
    reload();
  }

  function logHabit(habit: Habit, state: HabitLogState, note: string | null) {
    setHabitLog({
      habitId: habit.id,
      date: today(),
      state,
      at: new Date().toISOString(),
      note,
      mood: null,
    });
    reload();
  }

  if (!ready) {
    return (
      <>
        <AppHeader title="今日" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  const active = cards.filter((c) => (c.status ?? "active") !== "done");
  const all = active.flatMap((c) => c.tasks.map((t) => ({ card: c, task: t })));

  const openTasks = all
    .filter(({ task }) => !task.completedAt && isDueBy(task.dueDate))
    .sort(
      (a, b) =>
        a.task.dueDate.localeCompare(b.task.dueDate) ||
        (a.task.startTime ?? "99:99").localeCompare(b.task.startTime ?? "99:99"),
    );
  const nextOne = openTasks[0] ?? null;
  const restToday = openTasks.slice(1);
  const doneToday = all.filter(
    ({ task }) =>
      task.completedAt && toLocalDate(new Date(task.completedAt)) === today(),
  );
  const upcoming = all.filter(
    ({ task }) =>
      !task.completedAt && Boolean(task.dueDate) && !isDueBy(task.dueDate),
  );

  // 今日が予定日の習慣だけ。予定外の日に並べても押させるものがない
  const todayHabits = habits
    .map((h) => ({ habit: h, stats: computeStats(h, logs) }))
    .filter((x) => x.stats.dueToday);
  const habitsLeft = todayHabits.filter((x) => !x.stats.todayLog).length;

  const nothingYet = cards.length === 0;

  return (
    <>
      <AppHeader title="今日" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        {resumable && (
          <Link
            href="/session"
            className="mb-4 rounded-xl border border-accent-line bg-accent-soft px-4 py-3 text-[14px] font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            中断した対話を再開する →
          </Link>
        )}

        {nothingYet ? (
          <section className="mt-6 flex flex-col gap-4">
            <h1 className="font-serif text-[24px] leading-[1.45] font-bold text-balance">
              まだ、今日やることがありません
            </h1>
            <p className="text-[14px] leading-relaxed text-muted">
              先に目標を1つ決めると、ここに「明日の一歩」が並びます。
            </p>
            <Link
              href="/goals"
              className="rounded-xl bg-indigo px-4 py-3.5 text-center text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              目標をつくる
            </Link>
          </section>
        ) : (
          <>
            {/* 今日の一歩。状態によらず必ずこの位置に置く */}
            <section>
              <SectionLabel label="今日の一歩" />
              {nextOne ? (
                <NextStep
                  card={nextOne.card}
                  task={nextOne.task}
                  onToggle={() => toggleTask(nextOne.card.id, nextOne.task.id)}
                />
              ) : /*
                   「終わった」と言えるのは、今日やることが実際にあった場合だけ。
                   習慣もタスクも1件も無い日に「終わりました」と出すと、
                   何もしていないのに終わったことになる（実データで踏んだ）。
                 */
                doneToday.length > 0 ||
                (todayHabits.length > 0 && habitsLeft === 0) ? (
                <p className="mt-2 rounded-xl border border-accent-line bg-accent-soft px-4 py-4 text-center text-[13.5px] leading-relaxed text-accent">
                  今日ぶんは終わりました。
                </p>
              ) : (
                <p className="mt-2 rounded-xl border border-dashed border-line px-4 py-4 text-center text-[13px] leading-relaxed text-muted">
                  今日ぶんの予定はありません。
                  <br />
                  目標を開いて、次の一歩を決めておきましょう。
                </p>
              )}

              {restToday.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer px-1 text-[12.5px] text-muted">
                    今日やることが、ほかに{restToday.length}件
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {restToday.map(({ card, task }) => (
                      <SmallTask
                        key={task.id}
                        card={card}
                        task={task}
                        onToggle={() => toggleTask(card.id, task.id)}
                      />
                    ))}
                  </ul>
                </details>
              )}
            </section>

            {todayHabits.length > 0 && (
              <section className="mt-6">
                <SectionLabel
                  label={`今日の習慣  ${todayHabits.length - habitsLeft}/${todayHabits.length}`}
                />
                <div className="mt-2 flex flex-col gap-2">
                  {todayHabits.map(({ habit, stats }) => (
                    <HabitCheck
                      key={habit.id}
                      habit={habit}
                      stats={stats}
                      onLog={(state, note) => logHabit(habit, state, note)}
                    />
                  ))}
                </div>
              </section>
            )}

            {doneToday.length > 0 && (
              <section className="mt-6">
                <SectionLabel label={`今日やったこと  ${doneToday.length}`} />
                <ul className="mt-2 flex flex-col gap-2">
                  {doneToday.map(({ card, task }) => (
                    <SmallTask
                      key={task.id}
                      card={card}
                      task={task}
                      onToggle={() => toggleTask(card.id, task.id)}
                    />
                  ))}
                </ul>
              </section>
            )}

            {upcoming.length > 0 && (
              <p className="mt-3 px-1 text-[12px] text-muted">
                この先の予定が{upcoming.length}件あります。
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
      {label}
    </h2>
  );
}

/**
 * 今日の一歩。1件だけを大きく出す。
 *
 * 複数を同じ大きさで並べると、どれから手を付けるかを毎朝決め直すことになる。
 * 決めるのは対話のときに済ませてあるので、ここでは1件に絞って迷わせない。
 * 「いつ・どこで」を本文と同じ強さで見せるのは、それが実行意図の本体だから。
 */
function NextStep({
  card,
  task,
  onToggle,
}: {
  card: GoalCard;
  task: Task;
  onToggle: () => void;
}) {
  const late = isOverdue(task.dueDate);
  const when = [task.startTime, task.where].filter(Boolean).join(" ・ ");

  return (
    <div
      className={`mt-2 rounded-2xl border bg-accent-soft px-5 py-5 ${
        late ? "border-accent" : "border-accent-line"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] tracking-[0.08em] text-accent">
          {dueLabel(task.dueDate)}
        </span>
        {late && (
          <span className="rounded-full border border-accent px-2 py-0.5 text-[10.5px] text-accent">
            過ぎています
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-muted">
          {task.estimateMin}分
        </span>
      </div>

      {when && <p className="mt-2.5 font-mono text-[13px] text-accent">{when}</p>}

      <label className="mt-1.5 flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={false}
          onChange={onToggle}
          className="mt-1.5 h-5 w-5 shrink-0 accent-[var(--accent)]"
        />
        <span className="min-w-0 flex-1 font-serif text-[17px] leading-[1.6] font-bold">
          {task.title || "（やることが未記入）"}
        </span>
      </label>

      {!when && (
        <Link
          href={`/goal/${card.id}`}
          className="mt-3 block rounded-lg border border-accent-line bg-paper px-3 py-2 text-center text-[12.5px] text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          いつ・どこでやるか決める →
        </Link>
      )}

      <Link
        href={`/goal/${card.id}`}
        className="mt-3 block border-t border-accent-line pt-2.5 text-[12px] leading-relaxed text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {card.vision.refined || card.vision.raw || "（未記入の目標）"}
      </Link>
    </div>
  );
}

/** 一歩以外のタスク。今日の一歩より弱く出す */
function SmallTask({
  card,
  task,
  onToggle,
}: {
  card: GoalCard;
  task: Task;
  onToggle: () => void;
}) {
  const done = Boolean(task.completedAt);
  const when = [task.startTime, task.where].filter(Boolean).join(" ・ ");

  return (
    <li className="rounded-xl border border-line bg-surface px-4 py-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={done}
          onChange={onToggle}
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
        />
        <span className="min-w-0 flex-1">
          <span
            className={`block text-[14px] leading-relaxed ${
              done ? "text-muted line-through" : ""
            }`}
          >
            {task.title || "（やることが未記入）"}
          </span>
          <span className="mt-1 block font-mono text-[11px] text-muted">
            {when ? `${when} ・ ` : ""}
            {task.estimateMin}分 ・ {dueLabel(task.dueDate)}
          </span>
        </span>
      </label>
      <Link
        href={`/goal/${card.id}`}
        className="mt-1 block pl-7 text-[11.5px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {card.vision.refined || card.vision.raw || "（未記入の目標）"}
      </Link>
    </li>
  );
}
