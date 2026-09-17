"use client";

import { useState } from "react";
import { CheckpointEvaluationPanel } from "@/components/CheckpointEvaluationPanel";
import { EditableField } from "@/components/EditableField";
import {
  defaultPeriod,
  daysLeft,
  elapsedRatio,
  evaluationSummary,
  isEvaluated,
  isPeriodOver,
  measureOf,
  parseCheckpointTarget,
  withMeasure,
} from "@/lib/checkpoint";
import { deleteCheckpoint, upsertCheckpoint } from "@/lib/storage";
import type {
  Checkpoint,
  CheckpointEvaluation,
  CheckpointMeasure,
  CheckpointPeriodKind,
} from "@/types/goal";

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
  bigStoryValues = [],
  onChange,
}: {
  cardId: string;
  checkpoints: Checkpoint[];
  /** 建て方の評価パネルで、価値観チップの選択元にする */
  bigStoryValues?: string[];
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

      {sorted.map((c, i) => {
        // 2件以上並ぶと「編集」「消す」が同じ名前になり、読み上げで区別できない
        const name = `中間目標${i + 1}`;
        const over = isPeriodOver(c);
        const left = daysLeft(c);
        const ratio = Math.round(elapsedRatio(c) * 100);
        const isDraft = draft?.id === c.id;

        return (
          <div
            key={c.id}
            role="group"
            aria-label={name}
            className="rounded-lg border border-line bg-paper px-3 py-3"
          >
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
                label={`${name}の今週・今月やること`}
                value={c.title}
                onSave={(v) => patch(c, { title: v })}
              />
            </div>

            {/*
              測り方と目安（中間目標タブ、2026-09-17）。タブで足したものしか持っていなかったので、
              ここで作った中間目標にも時間・回数の目安を付けられるようにする。下書きはまだ対象が無い
            */}
            {!isDraft && (
              <MeasureField
                key={`${c.id}-${measureOf(c)}-${c.target ?? ""}`}
                name={name}
                c={c}
                onSave={(next) => patch(c, { measure: next.measure, target: next.target })}
              />
            )}

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
                      aria-label={`${name}を完了にする`}
                      className="text-[11.5px] text-accent underline"
                    >
                      完了にする
                    </button>
                    <button
                      type="button"
                      onClick={() => patch(c, { status: "abandoned" })}
                      aria-label={`${name}を今回は終わりにする`}
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
                    aria-label={`${name}を続きから戻す`}
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
                      aria-label={`${name}を消す`}
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
                    aria-label={`${name}を消す`}
                    className="ml-auto text-[11.5px] text-muted underline"
                  >
                    消す
                  </button>
                )}
              </div>
            )}

            {/*
              建て方の評価。既定は畳む（更新を専用の儀式にしない、という
              このエディタ全体の方針を評価パネルにも適用する）。
              下書きには出さない。評価する対象がまだ保存されていない
            */}
            {!isDraft && (
              <details className="mt-2.5 rounded-lg border border-line-soft bg-surface px-3 py-1.5">
                <summary className="flex min-h-9 cursor-pointer items-center gap-1.5 text-[11.5px] text-muted">
                  <span>たて方を評価する</span>
                  {isEvaluated(c.evaluation) && (
                    <span className="font-mono text-[10.5px] text-accent">
                      {evaluationSummary(c.evaluation)}
                    </span>
                  )}
                  {!isEvaluated(c.evaluation) && (
                    <span className="text-[10.5px]">（任意）</span>
                  )}
                </summary>
                <div className="pb-2.5 pt-1">
                  <CheckpointEvaluationPanel
                    evaluation={c.evaluation}
                    bigStoryValues={bigStoryValues}
                    onChange={(evaluation: CheckpointEvaluation) => patch(c, { evaluation })}
                  />
                </div>
              </details>
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

const MEASURES: [CheckpointMeasure, string, string][] = [
  ["time", "時間", "時間"],
  ["count", "回数", "回"],
  ["done", "達成", ""],
];

/**
 * 測り方と目安。目安は打ち終わり（フォーカスを外す・Enter）で保存する。
 * 1文字ごとに保存すると「1」を打った瞬間に目安1時間が同期に乗る。
 * 時間・回数へ切り替えたときは、目安を入れて初めて保存する（目安の無い「時間」を作らない）
 */
function MeasureField({
  name,
  c,
  onSave,
}: {
  name: string;
  c: Checkpoint;
  onSave: (next: Checkpoint) => void;
}) {
  const saved = measureOf(c);
  const [measure, setMeasure] = useState<CheckpointMeasure>(saved);
  const [raw, setRaw] = useState(c.target != null ? String(c.target) : "");
  const target = parseCheckpointTarget(measure, raw);
  const unit = MEASURES.find(([m]) => m === measure)?.[2] ?? "";

  function commit(m: CheckpointMeasure, t: number | null) {
    const next = withMeasure(c, m, t);
    // 目安が正しくないと withMeasure は元のまま返す。変わっていなければ保存しない
    if (measureOf(next) === saved && (next.target ?? null) === (c.target ?? null)) {
      // 測り方は同じまま空欄・0で抜けたら、保存されている目安に戻す（空欄なのに目安が残って見えないように）
      if (m === saved) setRaw(c.target != null ? String(c.target) : "");
      return;
    }
    onSave(next);
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted" aria-hidden="true">
        測り方
      </span>
      <div role="group" aria-label={`${name}の測り方`} className="flex gap-1">
        {MEASURES.map(([m, label]) => (
          <Kind
            key={m}
            on={measure === m}
            onClick={() => {
              setMeasure(m);
              if (m === "done") commit("done", null);
              else commit(m, parseCheckpointTarget(m, raw));
            }}
          >
            {label}
          </Kind>
        ))}
      </div>
      {measure !== "done" && (
        <label className="ml-auto flex items-center gap-1 text-[11.5px] text-muted">
          目安
          <input
            type="number"
            inputMode="decimal"
            min={measure === "time" ? 0.5 : 1}
            step={measure === "time" ? 0.5 : 1}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => commit(measure, target)}
            onKeyDown={(e) => e.key === "Enter" && commit(measure, target)}
            aria-label={`${name}の目安（${unit}）`}
            aria-invalid={raw !== "" && target === null}
            className="min-h-8 w-16 rounded-md border border-line bg-surface px-2 text-right text-[12.5px] tabular-nums text-ink"
          />
          {unit}
        </label>
      )}
      {measure !== saved && measure !== "done" && target === null && (
        <p className="w-full text-[11px] text-accent">
          目安を{measure === "count" ? "1以上の整数で" : "数で"}入れると保存されます
        </p>
      )}
    </div>
  );
}
