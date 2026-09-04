"use client";

import { useState } from "react";
import { scheduleLabel } from "@/lib/habit";
import type { Habit, HabitLogState, HabitStats } from "@/types/behavior";

/**
 * 習慣の3択チェック。
 *
 * ○×の2択にしないのは、「できなかった」しか選べないと
 * 押すこと自体が嫌になり、記録が止まるため。
 * 最小版という逃げ道を常に置いておく。
 *
 * 一言メモと気分はすべて任意にしてある。必須にした瞬間、
 * チェック率そのものが落ちる。
 */
export function HabitCheck({
  habit,
  stats,
  onLog,
}: {
  habit: Habit;
  stats: HabitStats;
  onLog: (state: HabitLogState, note: string | null) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const current = stats.todayLog?.state ?? null;
  const when = [habit.startTime, habit.where].filter(Boolean).join(" ・ ");

  function choose(state: HabitLogState) {
    onLog(state, null);
    // 「できた」ときだけ、ついでに一言を書ける導線を出す。
    // できなかった日に書かせようとすると、言い訳を書かせることになる
    setNoteOpen(state === "done" || state === "partial");
  }

  return (
    <div
      className={`rounded-xl border px-4 py-3.5 ${
        current === "done" || current === "partial"
          ? "border-accent-line bg-accent-soft"
          : "border-line bg-surface"
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 text-[14.5px] leading-relaxed font-medium">
          {habit.title}
        </span>
        {stats.streak > 0 && (
          <span className="shrink-0 font-mono text-[11px] text-accent">
            {stats.streak}日
          </span>
        )}
      </div>

      <p className="mt-0.5 font-mono text-[11px] text-muted">
        {when ? `${when} ・ ` : ""}
        {habit.estimateMin}分 ・ {scheduleLabel(habit)}
      </p>

      {habit.cue && (
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          きっかけ: {habit.cue}
        </p>
      )}

      {/*
        4つを横一列に並べると、幅420pxでは文字が切れて読めない。
        「やった／最小版でやった」を上段に大きく、
        「できなかった／休み」を下段に小さく置く。
        押してほしいものが押しやすい並びにする。
      */}
      <div className="mt-2.5 flex gap-1.5">
        <Choice
          label="できた"
          on={current === "done"}
          tone="ok"
          onClick={() => choose("done")}
        />
        {habit.minimalTitle && (
          <Choice
            label={habit.minimalTitle}
            on={current === "partial"}
            tone="ok"
            onClick={() => choose("partial")}
          />
        )}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <Choice
          label="できなかった"
          on={current === "missed"}
          tone="plain"
          small
          onClick={() => choose("missed")}
        />
        <Choice
          label="今日は休み"
          on={current === "skipped"}
          tone="plain"
          small
          onClick={() => choose("skipped")}
        />
      </div>

      {current === "missed" && (
        // 責めない。次に戻ってこられることだけ伝える（セルフ・コンパッション）
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          記録しておけば、あとで「どんな時にできないか」が見えます。
          {stats.freezeLeft > 0 && " 連続は途切れていません。"}
        </p>
      )}

      {noteOpen && (
        <div className="mt-2 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ひとこと（任意）"
            maxLength={200}
            className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
            aria-label="ひとことメモ"
          />
          <button
            type="button"
            onClick={() => {
              onLog(current ?? "done", note.trim() || null);
              setNote("");
              setNoteOpen(false);
            }}
            className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-muted"
          >
            残す
          </button>
        </div>
      )}

      {stats.todayLog?.note && !noteOpen && (
        <p className="mt-2 border-l-2 border-accent-line pl-2.5 text-[12.5px] leading-relaxed text-muted">
          {stats.todayLog.note}
        </p>
      )}
    </div>
  );
}

function Choice({
  label,
  on,
  tone,
  small,
  onClick,
}: {
  label: string;
  on: boolean;
  tone: "ok" | "plain";
  small?: boolean;
  onClick: () => void;
}) {
  const base = `min-w-0 flex-1 truncate rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
    small ? "px-2 py-1 text-[11.5px]" : "px-2.5 py-2 text-[13px]"
  }`;
  const style = on
    ? tone === "ok"
      ? "border-accent bg-accent text-surface"
      : "border-muted bg-surface-2 text-ink"
    : "border-line bg-paper text-muted";
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`${base} ${style}`}>
      {label}
    </button>
  );
}
