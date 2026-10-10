"use client";

import { useState } from "react";
import { EditableField } from "@/components/EditableField";
import { CelebrationField, FrictionField, MinimalField } from "@/components/HabitShapeFields";
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

function newDraft(cardId: string): Habit {
  return {
    id: crypto.randomUUID(),
    cardId,
    title: "",
    minimalTitle: "",
    estimateMin: 15,
    schedule: { kind: "daily" },
    startTime: null,
    where: null,
    cue: null,
    celebration: null,
    frictionSteps: null,
    createdAt: new Date().toISOString(),
    archivedAt: null,
  };
}

export function HabitEditor({
  cardId,
  habits,
  onChange,
  startWithDraft,
  hideAdd,
}: {
  cardId: string;
  habits: Habit[];
  onChange: () => void;
  /**
   * 開いた瞬間から、空の下書きを1件出す（習慣タブの「習慣を足す」用）。
   * 下書きは画面上だけで、最初の入力があるまで保存されない。
   */
  startWithDraft?: boolean;
  /** 「＋ 繰り返すことを足す」を出さない（1件だけを直すシート用） */
  hideAdd?: boolean;
}) {
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null);
  /*
   * 「＋ 繰り返すことを足す」を押した瞬間に空の習慣を保存していたため、
   * 触っただけで中身の無い習慣が1件残った（レビューで指摘）。
   * TimeBoxSheet が「この時間に入れる」を押すまで枠を作らないのと同じ考え方で、
   * 押した直後は画面上だけの下書きにし、最初の入力があったときに初めて保存する。
   */
  const [draft, setDraft] = useState<Habit | null>(() =>
    startWithDraft ? newDraft(cardId) : null,
  );

  function add() {
    if (draft) return; // 何も書いていない下書きが既にあるなら、それで足りる
    setDraft(newDraft(cardId));
  }

  function patch(h: Habit, over: Partial<Habit>) {
    const next = { ...h, ...over };
    upsertHabit(next);
    if (draft?.id === h.id) setDraft(null);
    onChange();
  }

  const rows = draft ? [...habits, draft] : habits;

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 && (
        <p className="text-[12.5px] leading-relaxed text-muted">
          繰り返す行動を決めておくと、［習慣］タブにチェック欄が出ます。
          一歩（1回きり）と違って、こちらは続き具合が記録されます。
        </p>
      )}

      {rows.map((h, i) => (
        // 2件以上並ぶと「編集」「やめる」が同じ名前になり、読み上げで区別できない
        <div
          key={h.id}
          role="group"
          aria-label={`習慣${i + 1}`}
          className="rounded-lg border border-line bg-paper px-3 py-3"
        >
          <EditableField
            label={`習慣${i + 1}の繰り返すこと`}
            value={h.title}
            onSave={(v) => patch(h, { title: v })}
          />

          {/* 習慣の型: ① きっかけ → ② 最小の行動 → ③ そのあとの祝い。どれも任意 */}
          <div className="mt-3">
            <p className="mb-1 text-[11px] text-muted">① きっかけ（〜したあとに）</p>
            <input
              type="text"
              value={h.cue ?? ""}
              placeholder="例: コーヒーを淹れたあとに"
              maxLength={100}
              onChange={(e) => patch(h, { cue: e.target.value || null })}
              className="w-full rounded-md border border-line bg-surface px-2.5 py-1 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
              aria-label={`習慣${i + 1}のきっかけ`}
            />
          </div>

          <div className="mt-3">
            <p className="mb-1 text-[11px] text-muted">② 最小の行動（〜する）</p>
            <MinimalField
              n={i + 1}
              value={h.minimalTitle}
              onSave={(v) => patch(h, { minimalTitle: v })}
            />
          </div>

          <div className="mt-3">
            <p className="mb-1.5 text-[11px] text-muted">③ そのあとの祝い（自分を褒める）</p>
            <CelebrationField
              n={i + 1}
              value={h.celebration ?? null}
              onChange={(v) => patch(h, { celebration: v })}
            />
          </div>

          <div className="mt-3">
            <FrictionField
              n={i + 1}
              value={h.frictionSteps ?? null}
              onChange={(v) => patch(h, { frictionSteps: v })}
            />
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
                  aria-label={`習慣${i + 1}の週あたりの回数`}
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
              aria-label={`習慣${i + 1}の開始時刻`}
            />
            <input
              type="text"
              value={h.where ?? ""}
              placeholder="どこで"
              maxLength={100}
              onChange={(e) => patch(h, { where: e.target.value || null })}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
              aria-label={`習慣${i + 1}のやる場所`}
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
                aria-label={`習慣${i + 1}の所要時間（分）`}
              />
              分
            </label>
          </div>

          {/* まだ保存していない下書きには「やめる」を出さない。やめる対象が無い */}
          {draft?.id !== h.id && (
          <div className="mt-2.5">
            {confirmArchive === h.id ? (
              <div className="rounded-md border border-line bg-surface px-2.5 py-2">
                <p className="text-[12px] leading-relaxed">
                  やめると［習慣］タブに出なくなります。これまでの記録は残ります。
                </p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      archiveHabit(h.id);
                      setConfirmArchive(null);
                      onChange();
                    }}
                    aria-label={`習慣${i + 1}をやめる`}
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
                aria-label={`習慣${i + 1}をやめる`}
                className="text-[11.5px] text-muted underline"
              >
                この習慣をやめる
              </button>
            )}
          </div>
          )}
        </div>
      ))}

      {!hideAdd && (
        <button
          type="button"
          onClick={add}
          className="text-left text-[12px] text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ＋ 繰り返すことを足す
        </button>
      )}
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
