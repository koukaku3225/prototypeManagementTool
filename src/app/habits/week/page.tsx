"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { EditableField } from "@/components/EditableField";
import { useDayRollover } from "@/hooks/useDayRollover";
import { today } from "@/lib/date";
import {
  buildWeekSummary,
  canWriteReview,
  mondayOf,
  parseWeek,
  previousNote,
  reviewOf,
  shiftWeek,
  weekPhase,
  weekRangeLabel,
} from "@/lib/habit-week";
import {
  loadCards,
  loadHabitLogs,
  loadHabits,
  loadTimeBoxes,
  loadWeeklyReviews,
  saveWeeklyReview,
} from "@/lib/storage";
import type { Habit, HabitLog, WeeklyReview } from "@/types/behavior";
import type { GoalCard } from "@/types/goal";
import type { TimeBox } from "@/types/timebox";

/**
 * 週のふりかえり。
 *
 * 1週間の数字を並べ、うまくいったことと「来週の自分へ」を一言だけ書く。
 * 数字は読んで並べるだけで保存しない。保存するのは本人が書いた一言だけ
 * （gc.weeklyreviews、欄を離れると保存）。判断は lib/habit-week.ts。
 *
 * 責めない。できなかった回数は事実として並べるだけで、色も言い回しも
 * 「足りない」を連想させない。書くことはすべて任意。
 */

const weekHref = (w: string) => `/habits/week?w=${w}`;

export default function HabitWeekPage() {
  const [ready, setReady] = useState(false);
  const [week, setWeek] = useState("");
  const [day, setDay] = useState(today());
  const [cards, setCards] = useState<GoalCard[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [boxes, setBoxes] = useState<TimeBox[]>([]);
  const [reviews, setReviews] = useState<WeeklyReview[]>([]);

  const reload = useCallback(() => {
    setCards(loadCards());
    setHabits(loadHabits());
    setLogs(loadHabitLogs());
    setBoxes(loadTimeBoxes());
    setReviews(loadWeeklyReviews());
    setDay(today());
  }, []);

  useEffect(() => {
    // useSearchParams ではなく location を読む（/habits/month と同じ）
    const raw = new URLSearchParams(location.search).get("w");
    setWeek(parseWeek(raw, today()));
    reload();
    setReady(true);
  }, [reload]);

  useDayRollover(() => reload());

  const retiredIds = useMemo(() => {
    const done = new Set(
      cards.filter((c) => (c.status ?? "active") === "done").map((c) => c.id),
    );
    return new Set(habits.filter((h) => done.has(h.cardId)).map((h) => h.id));
  }, [cards, habits]);

  const summary = useMemo(
    () => (week ? buildWeekSummary(habits, logs, boxes, week, day, { retiredIds }) : null),
    [habits, logs, boxes, week, day, retiredIds],
  );

  const go = (w: string) => {
    setWeek(w);
    // 再読み込みでも同じ週が開くよう URL にも残す（履歴は増やさない）
    history.replaceState(null, "", weekHref(w));
  };

  if (!ready || !week || !summary) {
    return (
      <>
        <AppHeader title="習慣" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  const thisWeek = mondayOf(day);
  const phase = weekPhase(week, day);
  const writable = canWriteReview(week, day);
  const note = previousNote(reviews, week);
  const current = reviewOf(reviews, week);
  const phaseLabel = phase === "current" ? "今週" : phase === "past" ? (week === shiftWeek(thisWeek, -1) ? "先週" : "") : "";

  const stat = (label: string, value: string, unit?: string) => (
    <div className="min-w-0 flex-1">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 text-[18px] font-bold tabular-nums leading-tight">
        {value}
        {unit && <span className="ml-0.5 text-[12px] font-normal text-muted">{unit}</span>}
      </p>
    </div>
  );

  return (
    <>
      <AppHeader title="習慣" />
      <main className="phone flex flex-1 flex-col px-5 py-5">
        <div>
          <Link
            href="/habits"
            className="inline-flex min-h-9 items-center gap-1 text-[12px] text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true">‹</span> 今日の習慣へ
          </Link>
        </div>

        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={() => go(shiftWeek(week, -1))}
            aria-label="前の週"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-[18px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1 text-center" aria-live="polite">
            <h1 className="font-serif text-[20px] font-bold tabular-nums">{weekRangeLabel(week)}</h1>
            <p className="h-4 text-[11px] leading-4 text-muted">{phaseLabel}</p>
          </div>
          <button
            type="button"
            onClick={() => go(shiftWeek(week, 1))}
            aria-label="次の週"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-[18px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ›
          </button>
        </div>
        {week !== thisWeek && (
          <div className="text-center">
            <button
              type="button"
              onClick={() => go(thisWeek)}
              className="min-h-9 rounded-lg px-3 text-[12px] text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              今週にもどる
            </button>
          </div>
        )}

        {note && (
          <section
            aria-label="前回の自分から"
            className="mt-4 rounded-xl border border-[var(--c-amber-line)] bg-[var(--c-amber-bg)] px-4 py-3 text-[var(--c-amber-fg)]"
          >
            <p className="text-[11.5px] font-bold">前回の自分から</p>
            <p className="mt-1 text-[14px] leading-relaxed whitespace-pre-wrap">「{note}」</p>
          </section>
        )}

        {phase === "future" ? (
          <p className="mt-5 rounded-xl border border-dashed border-line px-4 py-5 text-center text-[13px] leading-relaxed text-muted">
            まだ先の週です。ふりかえりは、その週になってから書けます。
          </p>
        ) : (
          <section aria-label="この週の数字" className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
            {summary.habitCount === 0 ? (
              <p className="text-[13px] leading-relaxed text-muted">
                この週に数える習慣はありません。
              </p>
            ) : (
              <>
                <div className="flex gap-3">
                  {stat(
                    "習慣",
                    summary.planned > 0 ? `${summary.achieved} / ${summary.planned}` : "—",
                    summary.planned > 0 ? "回" : undefined,
                  )}
                  {stat("最小版", String(summary.partial), "回")}
                  {summary.scoreAvg !== null && stat("できばえ平均", String(summary.scoreAvg))}
                </div>
                <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line-soft pt-2 text-[12px] text-muted">
                  <div className="flex gap-1">
                    <dt>できなかった</dt>
                    <dd className="tabular-nums text-ink">{summary.missed}回</dd>
                  </div>
                  {summary.skipped > 0 && (
                    <div className="flex gap-1">
                      <dt>休み</dt>
                      <dd className="tabular-nums text-ink">{summary.skipped}回</dd>
                    </div>
                  )}
                  {summary.extra > 0 && (
                    <div className="flex gap-1">
                      <dt>決めた曜日以外にやった</dt>
                      <dd className="tabular-nums text-ink">{summary.extra}回</dd>
                    </div>
                  )}
                </dl>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">
                  {phase === "current" && "今日までの分です。"}
                  やった＋最小版を、予定された回数で数えています。
                  {summary.warmingUpCount > 0 &&
                    `始めて14日たっていない習慣（${summary.warmingUpCount}件）は、上の「習慣」の回数に入れていません。`}
                </p>
              </>
            )}
          </section>
        )}

        {writable ? (
          // 週が変わったら入力欄を作り直す（前の週の書きかけを持ち越さない）
          <ReviewFields
            key={week}
            week={week}
            good={current?.good ?? ""}
            nextNote={current?.nextNote ?? ""}
            onSaved={() => setReviews(loadWeeklyReviews())}
          />
        ) : null}
      </main>
    </>
  );
}

function ReviewFields({
  week,
  good,
  nextNote,
  onSaved,
}: {
  week: string;
  good: string;
  nextNote: string;
  onSaved: () => void;
}) {
  /**
   * 保存するときは、画面の持っている値ではなく保存されている値と合わせる。
   * 2つの欄は別々に保存されるので、画面の古い値で片方を上書きしないため。
   */
  const save = (field: "good" | "nextNote", value: string) => {
    const cur = reviewOf(loadWeeklyReviews(), week);
    saveWeeklyReview(
      week,
      field === "good" ? value : (cur?.good ?? ""),
      field === "nextNote" ? value : (cur?.nextNote ?? ""),
    );
    onSaved();
  };

  return (
    <section className="mt-5 flex flex-col gap-4" aria-label="ふりかえり">
      <div>
        <h2 className="mb-1.5 px-0.5 text-[13px] font-medium">うまくいったこと</h2>
        <EditableField
          label="うまくいったこと"
          value={good}
          multiline
          onSave={(v) => save("good", v)}
        />
      </div>
      <div>
        <h2 className="mb-1.5 px-0.5 text-[13px] font-medium">来週の自分へ</h2>
        <EditableField
          label="来週の自分へ"
          value={nextNote}
          multiline
          onSave={(v) => save("nextNote", v)}
        />
        <p className="mt-0.5 px-0.5 text-[11px] leading-relaxed text-muted">
          どちらも任意です。書いた一言は、次の週の上に「前回の自分から」として出ます。
        </p>
      </div>
    </section>
  );
}
