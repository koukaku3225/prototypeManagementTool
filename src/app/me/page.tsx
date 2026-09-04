"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { Heatmap } from "@/components/Heatmap";
import {
  activeHabits,
  loadArchive,
  loadCardById,
  loadHabitLogs,
} from "@/lib/storage";
import {
  computeStats,
  daysSinceStart,
  heatmap,
  isWarmingUp,
  scheduleLabel,
  WARMUP_DAYS,
} from "@/lib/habit";
import type { Habit, HabitLog, HabitStats } from "@/types/behavior";

/**
 * わたし。
 *
 * 以前の「記録」タブは、名前に反して中身がチャット履歴だった。
 * 「記録」という一語が、数か月に1回見る"プロセスの記録"と、
 * 毎日見る"行動の記録"という別物を指していて、期待されている後者が
 * 丸ごと無かった。ここでは後者を主役にする。
 *
 * 対話ログは成果物に付属する出典であって、独立した居場所を持つほどの
 * 頻度で見るものではないので、この画面の下のほうへ降ろした。
 */
export default function MePage() {
  const [rows, setRows] = useState<
    { habit: Habit; stats: HabitStats; logs: HabitLog[]; cardTitle: string }[]
  >([]);
  const [sessions, setSessions] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const logs = loadHabitLogs();
    setRows(
      activeHabits().map((h) => ({
        habit: h,
        stats: computeStats(h, logs),
        logs,
        cardTitle:
          loadCardById(h.cardId)?.vision.refined ??
          loadCardById(h.cardId)?.vision.raw ??
          "",
      })),
    );
    setSessions(loadArchive().length);
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <>
        <AppHeader title="わたし" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  return (
    <>
      <AppHeader title="わたし" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          続いていること
        </h2>

        {rows.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-line px-4 py-5 text-center text-[13px] leading-relaxed text-muted">
            まだ習慣がありません。
            <br />
            目標を開いて、繰り返す行動を1つ決めてみてください。
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            {rows.map(({ habit, stats, logs, cardTitle }) => (
              <HabitRecord
                key={habit.id}
                habit={habit}
                stats={stats}
                logs={logs}
                cardTitle={cardTitle}
              />
            ))}
          </div>
        )}

        <h2 className="mt-8 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          そのほか
        </h2>
        <div className="mt-2 flex flex-col gap-2">
          <RowLink
            href="/history"
            title="対話のログ"
            note={
              sessions > 0
                ? `${sessions}件。目標がどう決まったかを読み返せます`
                : "まだありません"
            }
          />
          <RowLink href="/settings" title="設定" note="保存・書き出し・やり直し" />
          <RowLink href="/metrics" title="内部計測" note="開発用。M1〜M8" />
        </div>
      </main>
    </>
  );
}

function HabitRecord({
  habit,
  stats,
  logs,
  cardTitle,
}: {
  habit: Habit;
  stats: HabitStats;
  logs: HabitLog[];
  cardTitle: string;
}) {
  const warming = isWarmingUp(habit);
  const days = daysSinceStart(habit);

  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-4">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-[14px] leading-relaxed font-medium">
          {habit.title}
        </span>
        <span className="shrink-0 font-mono text-[10.5px] text-muted">
          {scheduleLabel(habit)}
        </span>
      </div>
      {cardTitle && (
        <p className="mt-0.5 truncate text-[11.5px] text-muted">{cardTitle}</p>
      )}

      {warming ? (
        /*
         * 始めて2週間は率もヒートマップも出さない。
         * 始めた翌日に「達成率 0%」を見せるのは、続ける気を削ぐだけで
         * 情報がない。代わりに、いま何日目かだけ伝える。
         */
        <p className="mt-3 rounded-lg border border-accent-line bg-accent-soft px-3 py-2.5 text-[12.5px] leading-relaxed text-accent">
          はじめて{Math.max(0, days)}日目。
          {WARMUP_DAYS}日たつと、続き具合をここに出します。
          {stats.streak > 0 && ` いまのところ${stats.streak}日続いています。`}
        </p>
      ) : (
        <>
          {/*
            指標は2つまで。ストリークと達成率とモメンタムを全部並べると、
            どれも「進捗」を表す似た数字で、読めなくなる。
          */}
          <div className="mt-3 flex gap-4">
            <Stat
              value={`${stats.streak}`}
              unit="日連続"
              note={stats.freezeLeft === 0 ? "保険を使用中" : undefined}
            />
            <Stat
              value={
                stats.scheduled30 === 0 ? "—" : `${Math.round(stats.rate30 * 100)}`
              }
              unit="% 直近30日"
              note={
                stats.scheduled30 > 0 ? `予定${stats.scheduled30}日` : "予定日なし"
              }
            />
          </div>

          <div className="mt-3.5">
            <Heatmap cells={heatmap(habit, logs, 35)} label="直近5週間" />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  value,
  unit,
  note,
}: {
  value: string;
  unit: string;
  note?: string;
}) {
  return (
    <div>
      <p className="font-mono text-[22px] leading-none font-bold">
        {value}
        <span className="ml-1 text-[11px] font-normal text-muted">{unit}</span>
      </p>
      {note && <p className="mt-1 text-[10.5px] text-muted">{note}</p>}
    </div>
  );
}

function RowLink({
  href,
  title,
  note,
}: {
  href: string;
  title: string;
  note: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="mt-0.5 block text-[11.5px] text-muted">{note}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-muted">
        →
      </span>
    </Link>
  );
}
