"use client";

import { useState } from "react";
import { EditableField } from "@/components/EditableField";
import { defaultPeriod, daysLeft, elapsedRatio, isPeriodOver } from "@/lib/checkpoint";
import { deleteCheckpoint, upsertCheckpoint } from "@/lib/storage";
import type { Checkpoint, CheckpointPeriodKind } from "@/types/goal";

/**
 * 目標にぶら下がる中間目標（週/月）の編集。
 *
 * 更新の手間を専用の儀式にしないことが最優先（2026-09-13の調査）。
 * HabitEditorと同じく、押した瞬間は保存せず最初の入力で初めて保存する。
 * 達成/未達成の二値評価はオール・オア・ナッシング思考を招くので、
 * 状態は「続ける／今回は終わりにする」の2択＋自動的な「完了」に留める。
 */
export function CheckpointEditor({
  cardId,
  checkpoints,
  onChange,
}: {
  cardId: string;
  checkpoints: Checkpoint[];
  onChange: () => void;
}) {
  const [draft, setDraft] = useState<Checkpoint | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function add(kind: CheckpointPeriodKind) {
    if (draft) return;
    const now = new Date().toISOString();
    setDraft({
      id: crypto.randomUUID(),
      cardId,
      title: "",
      period: { kind, ...defaultPeriod(kind) },
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  }

  function patch(c: Checkpoint, over: Partial<Checkpoint>) {
    const next = { ...c, ...over, updatedAt: new Date().toISOString() };
    upsertCheckpoint(next);
    if (draft?.id === c.id) setDraft(null);
    onChange();
  }

  const rows = draft ? [...checkpoints, draft] : checkpoints;
  const sorted = [...rows].sort((a, b) => a.period.end.localeCompare(b.period.end));

  return (
    <div className="flex flex-col gap-3">
      {sorted.length === 0 && (
        <p className="text-[12.5px] leading-relaxed text-muted">
          大きな目標を、今週・今月やることに分解しておくと、期限が近づいたときに
          「今なにをやるべきか」が迷わなくなります。
        </p>
      )}

      {sorted.map((c) => {
        const over = isPeriodOver(c);
        const left = daysLeft(c);
        const ratio = Math.round(elapsedRatio(c) * 100);
        const isDraft = draft?.id === c.id;

        return (
          <div key={c.id} className="rounded-lg border border-line bg-paper px-3 py-3">
            <div className="flex items-center gap-1.5">
              <Kind on={c.period.kind === "week"} onClick={() => patch(c, { period: { kind: "week", ...defaultPeriod("week") } })}>
                週
              </Kind>
              <Kind on={c.period.kind === "month"} onClick={() => patch(c, { period: { kind: "month", ...defaultPeriod("month") } })}>
                月
              </Kind>
              <span className="ml-auto font-mono text-[10.5px] text-muted">
                {c.period.start} 〜 {c.period.end}
              </span>
            </div>

            <div className="mt-2">
              {/*
                短い見出し（HabitEditorのtitleと同じ想定）なので単行にする。
                最初multilineにしたら、1行の見出しに対して縦に伸びるだけの
                textareaが出て使いにくかった（2026-09-13 実機確認）。
              */}
              <EditableField
                label="今週・今月やること"
                value={c.title}
                onSave={(v) => patch(c, { title: v })}
              />
            </div>

            {/* 進捗。達成率ではなく期間の消化率。中身の達成度は本人が状態で申告する */}
            {c.status === "active" && !isDraft && (
              <div className="mt-2.5">
                <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${ratio}%` }}
                  />
                </div>
                <p className="mt-1 font-mono text-[10.5px] text-muted">
                  {over ? "期間が終わっています" : left === 1 ? "残り1日" : `残り${left}日`}
                </p>
              </div>
            )}

            {c.status !== "active" && (
              <p className="mt-2 font-mono text-[10.5px] text-accent">
                {c.status === "done" ? "完了しました" : "今回は終わりにしました"}
              </p>
            )}

            {/* まだ保存していない下書きには操作を出さない。対象が無い */}
            {!isDraft && (
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {c.status === "active" && (
                  <>
                    <button
                      type="button"
                      onClick={() => patch(c, { status: "done" })}
                      className="text-[11.5px] text-accent underline"
                    >
                      完了にする
                    </button>
                    <button
                      type="button"
                      onClick={() => patch(c, { status: "abandoned" })}
                      className="text-[11.5px] text-muted underline"
                    >
                      今回は終わりにする
                    </button>
                  </>
                )}
                {c.status !== "active" && (
                  <button
                    type="button"
                    onClick={() => patch(c, { status: "active" })}
                    className="text-[11.5px] text-muted underline"
                  >
                    続きから戻す
                  </button>
                )}

                {confirmDelete === c.id ? (
                  <span className="flex items-center gap-2 text-[11.5px]">
                    消しますか？
                    <button
                      type="button"
                      onClick={() => {
                        deleteCheckpoint(c.id);
                        setConfirmDelete(null);
                        onChange();
                      }}
                      className="text-accent underline"
                    >
                      消す
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="text-muted underline"
                    >
                      やめる
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(c.id)}
                    className="ml-auto text-[11.5px] text-muted underline"
                  >
                    消す
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => add("week")}
          className="text-left text-[12px] text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ＋ 今週の中間目標を足す
        </button>
        <button
          type="button"
          onClick={() => add("month")}
          className="text-left text-[12px] text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ＋ 今月の中間目標を足す
        </button>
      </div>
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
      className={`rounded-md border px-2.5 py-1 text-[12px] ${
        on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"
      }`}
    >
      {children}
    </button>
  );
}
