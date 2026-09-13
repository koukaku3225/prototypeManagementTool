"use client";

import { EditableField } from "@/components/EditableField";
import { scoreTone, selfConcordanceScore } from "@/lib/checkpoint";
import { emptyCheckpointEvaluation, type CheckpointEvaluation } from "@/types/goal";

/**
 * 中期目標の建て方の評価パネル。
 *
 * 3軸（動機・価値観・人との関わり）は1つの点数に合算しない
 * （2026-09-13 設計）。触った瞬間に保存する。専用の保存ボタンは置かない
 * （できばえチップ・ドラッグ確定と同じ、この画面の一貫した作法）。
 *
 * 動機の4問はDaiGoの動画から「同一化・内的・取入的・外的」という
 * 分類の枠組みだけを借り、質問文はこちらで書き下ろしてある。
 */
const MOTIVE_ITEMS: {
  key: keyof CheckpointEvaluation["motives"];
  label: string;
  hint: string;
  /** 高いほど注意したい動機か（逆向きの色分けに使う） */
  caution?: boolean;
}[] = [
  {
    key: "identified",
    label: "自分で選んだと言える",
    hint: "昔は誰かに勧められたことでも、いまは自分の意思で続けている",
  },
  {
    key: "intrinsic",
    label: "やっている最中が楽しい",
    hint: "結果より、取り組んでいる時間そのものに惹かれている",
  },
  {
    key: "introjected",
    label: "やらないと落ち着かない",
    hint: "後ろめたさや、人と比べた焦りが動かしている面がある",
    caution: true,
  },
  {
    key: "external",
    label: "誰かの目や見返りが理由",
    hint: "評価・報酬・指示が無ければ、たぶん手をつけない",
    caution: true,
  },
];

export function CheckpointEvaluationPanel({
  evaluation,
  bigStoryValues,
  onChange,
}: {
  evaluation: CheckpointEvaluation | null | undefined;
  /** 大きな物語の価値観。選択元にする（無ければ空配列） */
  bigStoryValues: string[];
  onChange: (next: CheckpointEvaluation) => void;
}) {
  const e = evaluation ?? emptyCheckpointEvaluation();

  function patch(over: Partial<CheckpointEvaluation>) {
    onChange({ ...e, ...over, updatedAt: new Date().toISOString() });
  }

  const score = selfConcordanceScore(e.motives);
  const tone = scoreTone(score);

  return (
    <div className="flex flex-col gap-4">
      {/* ① 動機 */}
      <div>
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
            動機
          </p>
          <p
            className={`font-mono text-[11px] ${
              tone.tone === "good"
                ? "text-accent"
                : tone.tone === "warn"
                  ? "text-muted"
                  : "text-muted"
            }`}
          >
            {score >= 0 ? `+${score}` : score}　{tone.text}
          </p>
        </div>

        <div className="mt-2 flex flex-col gap-3">
          {MOTIVE_ITEMS.map((item) => (
            <label key={item.key} className="block">
              <div className="flex items-baseline justify-between">
                <span className="text-[12.5px]">{item.label}</span>
                <span className="font-mono text-[11px] text-muted">
                  {e.motives[item.key]}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={e.motives[item.key]}
                onChange={(ev) =>
                  patch({
                    motives: { ...e.motives, [item.key]: Number(ev.target.value) },
                  })
                }
                className="mt-1 w-full accent-[var(--accent)]"
                aria-label={item.label}
              />
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{item.hint}</p>
            </label>
          ))}
        </div>

        {tone.tone === "warn" && (
          <p className="mt-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-[11.5px] leading-relaxed text-accent">
            この目標をやめる必要はありません。続ける中で自分が得られるもの（新しいスキル・人との繋がり・将来の選択肢）を書き足してみると、感じ方が変わることがあります。
          </p>
        )}
      </div>

      {/* ② 価値観との一致 */}
      <div>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          価値観との一致
        </p>
        {bigStoryValues.length === 0 ? (
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
            大きな物語に価値観がまだ無いので、選べるものがありません。
          </p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {bigStoryValues.map((v) => {
              const on = e.linkedValues.includes(v);
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    patch({
                      linkedValues: on
                        ? e.linkedValues.filter((x) => x !== v)
                        : [...e.linkedValues, v],
                    })
                  }
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
                    on
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-muted"
                  }`}
                >
                  {v}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-2">
          <p className="mb-1 text-[11px] text-muted">なぜそれが大事か（一言でよい）</p>
          <EditableField
            label="なぜそれが大事か"
            value={e.whyItMatters}
            onSave={(v) => patch({ whyItMatters: v })}
          />
        </div>
      </div>

      {/* ③ 人との関わり */}
      <div>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          人との関わり
        </p>
        <div className="mt-1.5 flex gap-1.5">
          <button
            type="button"
            aria-pressed={e.hasBuddy}
            onClick={() => patch({ hasBuddy: true })}
            className={`rounded-md border px-3 py-1.5 text-[12px] ${
              e.hasBuddy
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-muted"
            }`}
          >
            一緒にやる人・報告する相手がいる
          </button>
          <button
            type="button"
            aria-pressed={!e.hasBuddy}
            onClick={() => patch({ hasBuddy: false })}
            className={`rounded-md border px-3 py-1.5 text-[12px] ${
              !e.hasBuddy
                ? "border-accent bg-accent-soft text-accent"
                : "border-line text-muted"
            }`}
          >
            自分だけでやる
          </button>
        </div>

        {e.hasBuddy && (
          <div className="mt-2">
            <p className="mb-1 text-[11px] text-muted">誰と・どう報告するか</p>
            <EditableField
              label="誰と・どう報告するか"
              value={e.buddyNote}
              onSave={(v) => patch({ buddyNote: v })}
            />
          </div>
        )}
      </div>
    </div>
  );
}
