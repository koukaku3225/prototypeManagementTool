"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { useDayRollover } from "@/hooks/useDayRollover";
import { today } from "@/lib/date";
import { goalCardLabel } from "@/lib/goal-card";
import { habitStartDate, scheduleLabel } from "@/lib/habit";
import {
  buildMonthGrid,
  groupRowsByCard,
  monthLabel,
  monthOf,
  parseMonth,
  shiftMonth,
  type MonthCellKind,
  type MonthRow,
} from "@/lib/habit-month";
import { loadCards, loadHabitLogs, loadHabits } from "@/lib/storage";
import type { Habit, HabitLog } from "@/types/behavior";
import type { GoalCard } from "@/types/goal";

/**
 * 月の見開き。
 *
 * 1か月を1枚で見る、バレットジャーナルの習慣トラッカーのような画面。
 * 行は習慣（長期目標ごとにまとめる）、列は日付。
 * 見るだけで、何も保存しない。数え方と判断は lib/habit-month.ts。
 *
 * 色だけに頼らない。マスの区別は「塗り・記号・枠の形・読み上げ」を併用する
 * （凡例は同じ表から作るので、描き分けと凡例が食い違わない）。
 */

const CELL: Record<
  MonthCellKind,
  { glyph: string; label: string; cls: string; legend: boolean }
> = {
  done: {
    glyph: "✓",
    label: "やった",
    cls: "border-indigo bg-indigo text-surface",
    legend: true,
  },
  partial: {
    glyph: "△",
    label: "最小版でやった",
    cls: "border-[var(--c-amber-line)] bg-[var(--c-amber-bg)] text-[var(--c-amber-fg)]",
    legend: true,
  },
  missed: {
    glyph: "×",
    label: "できなかった",
    cls: "border-[var(--c-rose-line)] bg-[var(--c-rose-bg)] text-[var(--c-rose-fg)]",
    legend: true,
  },
  skipped: {
    glyph: "休",
    label: "休み",
    cls: "border-[var(--c-slate-line)] bg-[var(--c-slate-bg)] text-[var(--c-slate-fg)]",
    legend: true,
  },
  unrecorded: {
    glyph: "",
    label: "予定日だが記録なし",
    cls: "border-line bg-surface-2 text-muted",
    legend: true,
  },
  open: {
    glyph: "",
    label: "今日（これから）",
    cls: "border-dashed border-accent bg-transparent text-accent",
    legend: false,
  },
  off: {
    glyph: "·",
    label: "予定のない日",
    cls: "border-transparent bg-transparent text-muted/60",
    legend: true,
  },
  none: {
    glyph: "·",
    label: "記録なし",
    cls: "border-transparent bg-transparent text-muted/60",
    legend: false,
  },
  future: {
    glyph: "",
    label: "まだ先",
    cls: "border-dashed border-line-soft bg-transparent",
    legend: true,
  },
  before: {
    glyph: "",
    label: "作る前",
    cls: "border-transparent",
    legend: true,
  },
  after: {
    glyph: "",
    label: "やめたあと",
    cls: "border-transparent",
    legend: false,
  },
};

/** 作る前・やめたあと。塗りではなく斜線で、空欄（予定のない日）と見分ける */
const HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--line-soft) 0 2px, transparent 2px 6px)",
};

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

export default function HabitMonthPage() {
  const [ready, setReady] = useState(false);
  const [month, setMonth] = useState<string>("");
  const [day, setDay] = useState(today());
  const [cards, setCards] = useState<GoalCard[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);

  const reload = useCallback(() => {
    setCards(loadCards());
    // 畳んだ習慣も読む。その月に記録があれば見開きに出すため（判断は habit-month.ts）
    setHabits(loadHabits());
    setLogs(loadHabitLogs());
    setDay(today());
  }, []);

  useEffect(() => {
    /*
     * useSearchParams ではなく location を読む（/plan と同じ）。この画面は
     * クライアントだけで完結していて、Suspense 境界を足す理由が無い。
     * 形の合わない値（abc・2026-13）は今月に戻す。
     */
    const raw = new URLSearchParams(location.search).get("m");
    setMonth(parseMonth(raw, monthOf(today())));
    reload();
    setReady(true);
  }, [reload]);

  useDayRollover(() => reload());

  const thisMonth = monthOf(day);

  /** 見られる最古の月。これより前へは進めない（空の月を延々さかのぼらせない） */
  const earliest = useMemo(() => {
    let min = thisMonth;
    for (const h of habits) {
      const s = monthOf(habitStartDate(h));
      if (s < min) min = s;
    }
    for (const l of logs) {
      const m = monthOf(l.date);
      if (/^\d{4}-\d{2}$/.test(m) && m < min) min = m;
    }
    return min;
  }, [habits, logs, thisMonth]);

  const retiredIds = useMemo(() => {
    const done = new Set(
      cards.filter((c) => (c.status ?? "active") === "done").map((c) => c.id),
    );
    return new Set(habits.filter((h) => done.has(h.cardId)).map((h) => h.id));
  }, [cards, habits]);

  const grid = useMemo(
    () => (month ? buildMonthGrid(habits, logs, month, day, { retiredIds }) : null),
    [habits, logs, month, day, retiredIds],
  );
  const groups = useMemo(
    () => (grid ? groupRowsByCard(grid.rows, cards.map((c) => c.id)) : []),
    [grid, cards],
  );

  const go = (m: string) => {
    setMonth(m);
    // 再読み込みや共有でも同じ月が開くよう、URL にも残す（履歴は増やさない）
    history.replaceState(null, "", `/habits/month?m=${m}`);
  };

  // 今月なら、今日の列が見えるところまで横にずらす
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const place = () => {
      const col = box.querySelector<HTMLElement>("[data-today-col]");
      if (!col) {
        box.scrollLeft = 0;
        return;
      }
      // 左に固定した習慣名の幅を除いた、日付の領域の真ん中あたりへ
      const first = box.querySelector<HTMLElement>("thead th");
      const fixed = first?.offsetWidth ?? 0;
      const boxLeft = box.getBoundingClientRect().left;
      const colLeft = col.getBoundingClientRect().left - boxLeft + box.scrollLeft;
      const area = box.clientWidth - fixed;
      box.scrollLeft = Math.max(0, colLeft - fixed - area / 2 + col.offsetWidth / 2);
    };
    // 表の幅が定まってから合わせる（描画直後は列幅が確定していないことがある）
    const id = requestAnimationFrame(place);
    return () => cancelAnimationFrame(id);
  }, [month, grid?.rows.length]);

  const labelOf = useCallback(
    (cardId: string) => {
      const c = cards.find((x) => x.id === cardId);
      return c ? goalCardLabel(c) : "（削除された目標）";
    },
    [cards],
  );

  if (!ready || !grid) {
    return (
      <>
        <AppHeader title="習慣" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  const canPrev = month > earliest;
  const canNext = month < thisMonth;
  const colCount = grid.days.length;

  return (
    <>
      <AppHeader title="習慣" />
      <main className="phone flex flex-1 flex-col py-5">
        <div className="px-5">
          <Link
            href="/habits"
            className="inline-flex min-h-9 items-center gap-1 text-[12px] text-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true">‹</span> 今日の習慣へ
          </Link>
        </div>

        <div className="mt-1 flex items-center gap-2 px-5">
          <button
            type="button"
            onClick={() => go(shiftMonth(month, -1))}
            disabled={!canPrev}
            aria-label="前の月"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-[18px] disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ‹
          </button>
          <h1
            className="min-w-0 flex-1 text-center font-serif text-[20px] font-bold"
            aria-live="polite"
          >
            {monthLabel(month)}
          </h1>
          <button
            type="button"
            onClick={() => go(shiftMonth(month, 1))}
            disabled={!canNext}
            aria-label="次の月"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-[18px] disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ›
          </button>
        </div>
        {month !== thisMonth && (
          <div className="mt-1 text-center">
            <button
              type="button"
              onClick={() => go(thisMonth)}
              className="min-h-9 rounded-lg px-3 text-[12px] text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              今月にもどる
            </button>
          </div>
        )}

        {habits.length === 0 ? (
          <section className="mt-6 flex flex-col gap-3 px-5">
            <p className="text-[14px] leading-relaxed text-muted">
              まだ、習慣がありません。習慣を足すと、ここに1か月ぶんのマスが並びます。
            </p>
            <Link
              href="/habits"
              className="min-h-11 rounded-xl bg-indigo px-4 py-3 text-center text-[14px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              習慣を足しに行く
            </Link>
          </section>
        ) : grid.rows.length === 0 ? (
          <p className="mx-5 mt-6 rounded-xl border border-dashed border-line px-4 py-5 text-center text-[13px] leading-relaxed text-muted">
            この月に出せる習慣はありません。
            {month < earliest && "（習慣を作る前の月です）"}
          </p>
        ) : (
          <>
            <div
              ref={scroller}
              className="mt-3 overflow-x-auto overscroll-x-contain border-y border-line bg-paper"
              tabIndex={0}
              role="region"
              aria-label={`${monthLabel(month)}の習慣の記録。横にスクロールできます`}
            >
              <table className="border-separate border-spacing-0 text-[11px]">
                <caption className="sr-only">
                  {monthLabel(month)}の習慣の記録。行が習慣、列が日付です。
                </caption>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 z-20 w-[112px] min-w-[112px] max-w-[112px] border-b border-r border-line bg-paper px-2 py-1 text-left text-[10.5px] font-normal text-muted"
                    >
                      習慣
                    </th>
                    {grid.days.map((d) => (
                      <th
                        key={d.date}
                        scope="col"
                        data-today-col={d.isToday ? "" : undefined}
                        aria-current={d.isToday ? "date" : undefined}
                        className={`h-10 w-7 min-w-7 border-b border-line px-0 text-center font-normal tabular-nums ${
                          d.weekStart ? "border-l border-l-line" : ""
                        } ${d.isToday ? "bg-accent-soft text-accent" : "text-muted"}`}
                      >
                        <span className="block text-[11px] leading-4 font-medium">{d.day}</span>
                        <span
                          className={`block text-[9.5px] leading-3 ${
                            d.dow === 0 ? "text-[var(--c-rose-fg)]" : d.dow === 6 ? "text-indigo" : ""
                          }`}
                        >
                          {DOW[d.dow]}
                        </span>
                        {d.isToday && <span className="sr-only">（今日）</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <GroupRows
                      key={g.cardId}
                      label={labelOf(g.cardId)}
                      cardId={g.cardId}
                      rows={g.rows}
                      colCount={colCount}
                      knownCard={cards.some((c) => c.id === g.cardId)}
                      days={grid.days}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <Legend />
          </>
        )}
      </main>
    </>
  );
}

function GroupRows({
  label,
  cardId,
  rows,
  colCount,
  knownCard,
  days,
}: {
  label: string;
  cardId: string;
  rows: MonthRow[];
  colCount: number;
  knownCard: boolean;
  days: { date: string; isToday: boolean; weekStart: boolean }[];
}) {
  return (
    <>
      <tr>
        <th
          scope="colgroup"
          colSpan={colCount + 1}
          className="border-b border-line-soft bg-surface-2/60 p-0 text-left font-normal"
        >
          {/* 横にスクロールしても目標名が左に残る。幅いっぱいのセルの中の sticky */}
          <div className="sticky left-0 box-border w-[min(100vw,420px)] px-2 py-1 text-[11px] text-muted">
            {knownCard ? (
              <Link
                href={`/goal/${cardId}#sec-habit`}
                className="flex items-center gap-1.5 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <span aria-hidden="true">▸</span>
                <span className="truncate">{label}</span>
              </Link>
            ) : (
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true">▸</span>
                <span className="truncate">{label}</span>
              </span>
            )}
          </div>
        </th>
      </tr>
      {rows.map((r) => (
        <HabitRow key={r.habit.id} row={r} days={days} />
      ))}
    </>
  );
}

function summaryOf(row: MonthRow): string {
  const s = row.stats;
  const parts = [`${s.kept}回`];
  if (s.rate !== null) parts.push(`${Math.round(s.rate * 100)}%`);
  else if (s.warmingUp) parts.push("立ち上がり中");
  return parts.join(" ・ ");
}

function HabitRow({
  row,
  days,
}: {
  row: MonthRow;
  days: { date: string; isToday: boolean; weekStart: boolean }[];
}) {
  const { habit, stats } = row;
  return (
    <tr>
      <th
        scope="row"
        className="sticky left-0 z-10 w-[112px] min-w-[112px] max-w-[112px] border-b border-r border-line-soft bg-paper px-2 py-1 text-left align-middle font-normal"
      >
        <span className="block text-[12.5px] leading-snug break-words text-ink">
          {habit.title}
          {row.archived && (
            <span className="ml-1 rounded border border-line px-1 text-[9.5px] text-muted">
              やめた
            </span>
          )}
        </span>
        <span className="block text-[10.5px] leading-tight tabular-nums text-muted">
          {summaryOf(row)}
        </span>
        <span className="sr-only">
          （{scheduleLabel(habit)}。この月は{stats.kept}回やりました
          {stats.rate !== null ? `。達成率${Math.round(stats.rate * 100)}パーセント` : ""}
          {stats.warmingUp ? "。始めたばかりなので達成率は出していません" : ""}）
        </span>
      </th>
      {row.cells.map((c, i) => {
        const def = CELL[c.kind];
        const d = days[i];
        const hatch = c.kind === "before" || c.kind === "after";
        return (
          <td
            key={c.date}
            className={`h-9 w-7 min-w-7 border-b border-line-soft p-0.5 text-center ${
              d.weekStart ? "border-l border-l-line-soft" : ""
            } ${d.isToday ? "bg-accent-soft/60" : ""}`}
          >
            <span
              title={`${Number(c.date.slice(8))}日 ${def.label}${c.extra ? "（予定外の日）" : ""}`}
              style={hatch ? HATCH : undefined}
              className={`relative flex h-6 w-6 items-center justify-center rounded-[5px] border text-[11px] leading-none font-bold ${def.cls}`}
            >
              <span aria-hidden="true">{def.glyph}</span>
              {c.extra && (
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent"
                />
              )}
              <span className="sr-only">
                {def.label}
                {c.extra ? "（予定外の日）" : ""}
              </span>
            </span>
          </td>
        );
      })}
    </tr>
  );
}

function Legend() {
  const items = (Object.keys(CELL) as MonthCellKind[]).filter((k) => CELL[k].legend);
  return (
    <section className="mt-3 px-5" aria-label="マスの見方">
      <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
        {items.map((k) => {
          const def = CELL[k];
          const hatch = k === "before" || k === "after";
          return (
            <li key={k} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span
                aria-hidden="true"
                style={hatch ? HATCH : undefined}
                className={`flex h-5 w-5 items-center justify-center rounded-[4px] border text-[10px] leading-none font-bold ${def.cls}`}
              >
                {def.glyph}
              </span>
              {def.label}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        週◯回の習慣は曜日を決めないので、やった日だけを塗ります。
        <span
          aria-hidden="true"
          className="mx-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle"
        />
        は、決めた曜日以外にやった日です。回数と率は、その月のぶんです。
      </p>
    </section>
  );
}
