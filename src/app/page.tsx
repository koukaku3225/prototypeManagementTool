"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { HabitCheck } from "@/components/HabitCheck";
import { NowBar } from "@/components/NowBar";
import { TimeBoxSheet } from "@/components/TimeBoxSheet";
import {
  activeHabits,
  deleteTimeBox,
  loadCards,
  loadHabitLogs,
  loadSession,
  setHabitLog,
  timeBoxesOn,
  upsertTimeBox,
} from "@/lib/storage";
import { computeStats } from "@/lib/habit";
import {
  colorOf,
  currentBox,
  durationMin,
  humanDuration,
  nextBox,
  slotFromNow,
  toMinutes,
  totalMinutes,
} from "@/lib/timebox";
import { today } from "@/lib/date";
import type { GoalCard } from "@/types/goal";
import type { Habit, HabitLog, HabitLogState } from "@/types/behavior";
import { emptyMeta, emptyReview, type TimeBox } from "@/types/timebox";

/**
 * 今日。
 *
 * 起動して最初に出る画面で、ここだけが「続けるモード」に属する。
 * 決めた内容（大きな物語・目標の全項目）は［目標］タブへ移した。
 *
 * 以前あった「今日の一歩」（単発タスク）はタイムボックスへ統合した。
 * やることだけ決めて時間を決めないと、他のことに時間を奪われる。
 * ここでは今日の予定を時刻順に並べ、いま何の時間かを下に出し続ける。
 */
export default function TodayPage() {
  const [cards, setCards] = useState<GoalCard[]>([]);
  const [boxes, setBoxes] = useState<TimeBox[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [editing, setEditing] = useState<TimeBox | null>(null);
  /** 編集中の枠がまだ保存されていないか。保存を押すまで作らない */
  const [isNew, setIsNew] = useState(false);
  const [nowMinutes, setNow] = useState(0);
  const [resumable, setResumable] = useState(false);
  const [ready, setReady] = useState(false);

  const reload = useCallback(() => {
    setCards(loadCards());
    setBoxes(timeBoxesOn(today()));
    setHabits(activeHabits());
    setLogs(loadHabitLogs());
  }, []);

  useEffect(() => {
    reload();
    const s = loadSession();
    setResumable(Boolean(s && !s.completedAt && s.messages.length > 0));
    setReady(true);
  }, [reload]);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  function saveBox(b: TimeBox) {
    upsertTimeBox(b);
    reload();
    setIsNew(false);
    setEditing((prev) => (prev && prev.id === b.id ? b : prev));
  }

  function closeSheet() {
    setEditing(null);
    setIsNew(false);
  }

  function openBox(b: TimeBox) {
    setIsNew(false);
    setEditing(b);
  }

  /**
   * いまの時刻から始まる枠の下書きを開く。
   * 「いま何をやるか決める」が一番多い使い方なので、既定は現在時刻にする。
   */
  function addNow() {
    const { start, end } = slotFromNow(nowMinutes);
    setEditing({
      id: crypto.randomUUID(),
      date: today(),
      start,
      end,
      title: "",
      cardId: null,
      color: null,
      meta: emptyMeta(),
      completedAt: null,
      review: null,
      createdAt: new Date().toISOString(),
    });
    setIsNew(true);
  }

  function completeBox(b: TimeBox) {
    const done: TimeBox = {
      ...b,
      completedAt: new Date().toISOString(),
      review: b.review ?? emptyReview(),
    };
    saveBox(done);
    // 終わった直後に、振り返りを書ける状態で開く
    setIsNew(false);
    setEditing(done);
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
  const titleOf = (cardId: string | null) =>
    cardId
      ? (cards.find((c) => c.id === cardId)?.vision.refined ??
        cards.find((c) => c.id === cardId)?.vision.raw ??
        "")
      : "";

  const openBoxes = boxes.filter((b) => !b.completedAt);
  const doneBoxes = boxes.filter((b) => b.completedAt);
  const current = currentBox(boxes, nowMinutes);
  const upcoming = nextBox(boxes, nowMinutes, 60);

  const todayHabits = habits
    .map((h) => ({ habit: h, stats: computeStats(h, logs) }))
    .filter((x) => x.stats.dueToday);
  const habitsLeft = todayHabits.filter((x) => !x.stats.todayLog).length;

  const nothingYet = cards.length === 0 && boxes.length === 0;

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
              まだ、今日の予定がありません
            </h1>
            <p className="text-[14px] leading-relaxed text-muted">
              時間割で空いているところを押すと、その時間を押さえられます。
              先に目標を決めておくと、予定をそれに紐づけられます。
            </p>
            <Link
              href="/plan"
              className="rounded-xl bg-indigo px-4 py-3.5 text-center text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              時間割をひらく
            </Link>
            <Link
              href="/goals"
              className="rounded-xl border border-line bg-surface px-4 py-3 text-center text-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              先に目標をつくる
            </Link>
          </section>
        ) : (
          <>
            {/* 今日の予定 */}
            <section>
              <div className="flex items-baseline gap-2">
                <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                  今日の予定 {doneBoxes.length}/{boxes.length}
                </h2>
                {/* 下線つきの文字は指で狙いにくい。面のあるボタンにする */}
                <Link
                  href="/plan"
                  className="ml-auto flex min-h-11 items-center rounded-full border border-line bg-surface px-3.5 text-[12.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  時間割をひらく
                </Link>
              </div>

              {boxes.length === 0 ? (
                <Link
                  href="/plan"
                  className="mt-2 block rounded-xl border border-dashed border-line px-4 py-4 text-center text-[13px] leading-relaxed text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  今日の予定はありません。
                  <br />
                  時間割で、やる時間を押さえておきましょう。
                </Link>
              ) : (
                <>
                  <p className="mt-1 font-mono text-[11px] text-muted">
                    予定 {humanDuration(totalMinutes(boxes))}
                    {doneBoxes.length > 0 &&
                      ` / 完了 ${humanDuration(totalMinutes(boxes, true))}`}
                  </p>
                  <ul className="mt-2 flex flex-col gap-2">
                    {openBoxes.map((b) => (
                      <BoxRow
                        key={b.id}
                        box={b}
                        goalTitle={titleOf(b.cardId)}
                        running={current?.id === b.id}
                        past={(toMinutes(b.end) ?? 0) <= nowMinutes}
                        onOpen={() => openBox(b)}
                        onComplete={() => completeBox(b)}
                      />
                    ))}
                  </ul>

                  {doneBoxes.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer px-1 text-[12.5px] text-muted">
                        終わった予定 {doneBoxes.length}件
                      </summary>
                      <ul className="mt-2 flex flex-col gap-2">
                        {doneBoxes.map((b) => (
                          <BoxRow
                            key={b.id}
                            box={b}
                            goalTitle={titleOf(b.cardId)}
                            running={false}
                            past
                            onOpen={() => openBox(b)}
                            onComplete={() => completeBox(b)}
                          />
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </section>

            {/*
              予定を足す入口。以前は「空きを押す」しか手段がなく、
              初見では作り方が分からなかった。既定の時刻はいま
            */}
            <button
              type="button"
              onClick={addNow}
              className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-[14px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span aria-hidden="true" className="text-[18px] leading-none">
                ＋
              </span>
              いま（{slotFromNow(nowMinutes).start}）から予定を入れる
            </button>

            {todayHabits.length > 0 && (
              <section className="mt-6">
                <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                  今日の習慣 {todayHabits.length - habitsLeft}/{todayHabits.length}
                </h2>
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

            {active.length === 0 && cards.length > 0 && (
              <p className="mt-4 px-1 text-[12px] leading-relaxed text-muted">
                進行中の目標がありません。
                <Link href="/goals" className="ml-1 underline">
                  目標を見る
                </Link>
              </p>
            )}
          </>
        )}
      </main>

      <NowBar
        current={current}
        next={upcoming}
        nowMinutes={nowMinutes}
        onComplete={completeBox}
        onEdit={openBox}
      />

      {editing && (
        <TimeBoxSheet
          box={editing}
          cards={active}
          isNew={isNew}
          onSave={saveBox}
          onDelete={(id) => {
            deleteTimeBox(id);
            reload();
            closeSheet();
          }}
          onClose={closeSheet}
        />
      )}
    </>
  );
}

/** 予定1件。時刻を先に、やることをその下に */
function BoxRow({
  box,
  goalTitle,
  running,
  past,
  onOpen,
  onComplete,
}: {
  box: TimeBox;
  goalTitle: string;
  running: boolean;
  past: boolean;
  onOpen: () => void;
  onComplete: () => void;
}) {
  const done = Boolean(box.completedAt);

  return (
    <li
      className={`overflow-hidden rounded-xl border px-4 py-3 ${
        running
          ? "border-accent bg-accent-soft"
          : done
            ? "border-line bg-surface opacity-70"
            : "border-line bg-surface"
      }`}
      // 時間割と同じ色を細い帯で出す。どの目標のためかが一目で分かる
      style={
        done
          ? undefined
          : { boxShadow: `inset 4px 0 0 var(--c-${colorOf(box)}-line)` }
      }
    >
      <div className="flex items-start gap-3">
        {/*
          チェックは見た目が小さくてよいが、指の当たりは44pxいる。
          -m-3 で外側へ広げているので、並びの見え方は変わらない
        */}
        {!done && (
          <button
            type="button"
            onClick={onComplete}
            aria-label={`${box.title || "この予定"}を完了にする`}
            className="-m-3 flex h-11 w-11 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span
              aria-hidden="true"
              className="h-5 w-5 rounded-md border-2 border-line"
            />
          </button>
        )}
        {done && (
          <span
            aria-hidden="true"
            className="-m-3 flex h-11 w-11 shrink-0 items-center justify-center"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent text-[12px] text-surface">
              ✓
            </span>
          </span>
        )}

        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex items-baseline gap-2">
            <span
              className={`font-mono text-[11.5px] ${
                running ? "text-accent" : past && !done ? "text-muted" : "text-muted"
              }`}
            >
              {box.start}〜{box.end}
            </span>
            {running && (
              <span className="rounded-full border border-accent px-1.5 py-0.5 text-[10px] text-accent">
                いま
              </span>
            )}
            {past && !done && !running && (
              <span className="text-[10.5px] text-muted">過ぎています</span>
            )}
            {/* 完了ぶんは、できばえがあれば時間の隣に出す。開かなくても見える */}
            {done && box.review?.score != null && (
              <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {box.review.score}%
              </span>
            )}
            <span className="ml-auto font-mono text-[10.5px] text-muted">
              {humanDuration(durationMin(box))}
            </span>
          </span>

          <span
            className={`mt-0.5 block text-[14.5px] leading-relaxed ${
              done ? "text-muted line-through" : "font-medium"
            }`}
          >
            {box.title || "（未記入）"}
          </span>

          {goalTitle && (
            <span className="mt-1 block truncate text-[11.5px] text-muted">
              {goalTitle}
            </span>
          )}
        </button>
      </div>
    </li>
  );
}
