"use client";

import { useState } from "react";
import { EditableField } from "@/components/EditableField";
import { normalizeTime } from "@/lib/date";
import { scheduleLabel } from "@/lib/habit";
import { archiveHabit, upsertHabit } from "@/lib/storage";
import type { Habit, HabitSchedule } from "@/types/behavior";

/**
 * 目標にぶら下がる習慣の編集。
 *
 * Task（明日やる1件）と Habit（繰り返すもの）を同じ画面に置くのは、
 * どちらも「この目標のために何をするか」だからで、
 * 別画面に分けると、片方だけ設定して終わる。
 */
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

export function HabitEditor({
  cardId,
  habits,
  onChange,
}: {
  cardId: string;
  habits: Habit[];
  onChange: () => void;
}) {
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);

  function add() {
    const now = new Date().toISOString();
    upsertHabit({
      id: crypto.randomUUID(),
      cardId,
      title: "",
      minimalTitle: "",
      estimateMin: 15,
      schedule: { kind: "daily" },
      startTime: null,
      where: null,
      cue: null,
      createdAt: now,
      archivedAt: null,
    });
    onChange();
  }

  function patch(h: Habit, over: Partial<Habit>) {
    upsertHabit({ ...h, ...over });
    onChange();
  }

  return (
    <div className="flex flex-col gap-3">
      {habits.length === 0 && (
        <p className="text-[12.5px] leading-relaxed text-muted">
          繰り返す行動を決めておくと、［今日］にチェック欄が出ます。
          一歩（1回きり）と違って、こちらは続き具合が記録されます。
        </p>
      )}

      {habits.map((h) => (
        <div key={h.id} className="rounded-lg border border-line bg-paper px-3 py-3">
          <EditableField
            label="繰り返すこと"
            value={h.title}
            onSave={(v) => patch(h, { title: v })}
          />

          <div className="mt-2">
            <p className="mb-1 text-[11px] text-muted">
              これだけならできる（最小版）
            </p>
            <EditableField
              label="最小版"
              value={h.minimalTitle}
              onSave={(v) => patch(h, { minimalTitle: v })}
            />
            <p className="mt-1 text-[11px] leading-relaxed text-muted">
              無理な日にゼロにするより、最小版でも続けたほうが途切れません。
            </p>
          </div>

          {/* 繰り返し */}
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] text-muted">
              いつやるか（{scheduleLabel(h)}）
            </p>
            <div className="flex gap-1.5">
              <Kind
                on={h.schedule.kind === "daily"}
                onClick={() => patch(h, { schedule: { kind: "daily" } })}
              >
                毎日
              </Kind>
              <Kind
                on={h.schedule.kind === "weekdays"}
                onClick={() =>
                  patch(h, { schedule: { kind: "weekdays", days: [1, 3, 5] } })
                }
              >
                曜日
              </Kind>
              <Kind
                on={h.schedule.kind === "timesPerWeek"}
                onClick={() =>
                  patch(h, { schedule: { kind: "timesPerWeek", times: 3 } })
                }
              >
                週N回
              </Kind>
            </div>

            {h.schedule.kind === "weekdays" && (
              <div className="mt-2 flex gap-1">
                {DOW.map((label, d) => {
                  const days = (h.schedule as { days: number[] }).days;
                  const on = days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        patch(h, {
                          schedule: {
                            kind: "weekdays",
                            days: on ? days.filter((x) => x !== d) : [...days, d],
                          } satisfies HabitSchedule,
                        })
                      }
                      className={`flex-1 rounded-md border py-1 text-[11.5px] ${
                        on
                          ? "border-accent bg-accent text-surface"
                          : "border-line text-muted"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {h.schedule.kind === "timesPerWeek" && (
              <label className="mt-2 flex items-center gap-2 font-mono text-[11.5px] text-muted">
                週
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={(h.schedule as { times: number }).times}
                  onChange={(e) =>
                    patch(h, {
                      schedule: {
                        kind: "timesPerWeek",
                        times: Math.min(7, Math.max(1, Number(e.target.value) || 1)),
                      },
                    })
                  }
                  className="w-14 rounded-md border border-line bg-surface px-2 py-1 text-right"
                  aria-label="週あたりの回数"
                />
                回
              </label>
            )}
          </div>

          {/* 実行意図 */}
          <div className="mt-3 flex items-center gap-2">
            <input
              type="time"
              value={h.startTime ?? ""}
              onChange={(e) => patch(h, { startTime: normalizeTime(e.target.value) })}
              className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-[12px]"
              aria-label="開始時刻"
            />
            <input
              type="text"
              value={h.where ?? ""}
              placeholder="どこで"
              maxLength={100}
              onChange={(e) => patch(h, { where: e.target.value || null })}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
              aria-label="やる場所"
            />
            <label className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted">
              <input
                type="number"
                min={1}
                max={480}
                value={h.estimateMin}
                onChange={(e) =>
                  patch(h, { estimateMin: Math.max(1, Number(e.target.value) || 1) })
                }
                className="w-14 rounded-md border border-line bg-surface px-2 py-1 text-right"
                aria-label="所要時間（分）"
              />
              分
            </label>
          </div>

          <div className="mt-2">
            <input
              type="text"
              value={h.cue ?? ""}
              placeholder="きっかけ（例: 朝コーヒーを淹れたら）"
              maxLength={100}
              onChange={(e) => patch(h, { cue: e.target.value || null })}
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
              aria-label="きっかけ"
            />
          </div>

          <div className="mt-2.5">
            {confirmArchive === h.id ? (
              <div className="rounded-md border border-line bg-surface px-2.5 py-2">
                <p className="text-[12px] leading-relaxed">
                  やめると［今日］に出なくなります。これまでの記録は残ります。
                </p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      archiveHabit(h.id);
                      setConfirmArchive(null);
                      onChange();
                    }}
                    className="rounded-md border border-line px-2.5 py-1 text-[11.5px] text-muted"
                  >
                    やめる
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmArchive(null)}
                    className="rounded-md px-2.5 py-1 text-[11.5px] text-muted"
                  >
                    続ける
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmArchive(h.id)}
                className="text-[11.5px] text-muted underline"
              >
                この習慣をやめる
              </button>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="text-left text-[12px] text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        ＋ 繰り返すことを足す
      </button>
    </div>
  );
}

function Kind({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex-1 rounded-md border px-2 py-1 text-[12px] ${
        on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"
      }`}
    >
      {children}
    </button>
  );
}
