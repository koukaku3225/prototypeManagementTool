"use client";

import { useEffect, useState } from "react";
import {
  BOX_COLORS,
  COLOR_LABEL,
  colorOf,
  durationMin,
  humanDuration,
  normalizeRange,
} from "@/lib/timebox";
import { isGhost } from "@/lib/habit-plan";
import { goalCardLabel } from "@/lib/goal-card";
import { emptyReview, type TimeBox } from "@/types/timebox";
import type { GoalCard } from "@/types/goal";

/**
 * 枠を押したときに下から出るシート。
 *
 * Googleカレンダーは枠を押すと詳細が開き、そこから編集・削除に入る。
 * 同じ形にしてあるが、こちらは「見る」と「直す」を分けない。
 * 項目数が少ないので、開いたらそのまま直せるほうが手数が減る。
 *
 * メタ認知の3項目（なぜ重要か／何が障害か／対策は）を枠に持たせるのは、
 * その場になってから考えるのでは間に合わないため。先に書いて、
 * 時間が来たら読むだけにする。ただし毎回開いておくと、
 * 縦に3つ並ぶだけで主操作（完了・保存）が画面の外へ押し出されるので、
 * 中身があるときだけ開いた状態にする。
 */
export function TimeBoxSheet({
  box,
  cards,
  isNew = false,
  onSave,
  onDelete,
  onClose,
}: {
  box: TimeBox;
  cards: GoalCard[];
  /** まだ保存していない新しい枠。保存を押すまで作らない */
  isNew?: boolean;
  onSave: (b: TimeBox) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<TimeBox>(box);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  /*
   * 見ている枠が「別のものに変わった」ときだけ状態を戻す。
   *
   * box そのものを依存に置くと、保存のたびに親が新しいオブジェクトを渡してきて
   * ここが走り、振り返り画面に入った瞬間に閉じてしまう
   * （完了を押す → 保存 → 親が更新 → reviewing が false に戻る）。
   * 編集中の中身は draft が持っているので、id だけ見ればよい。
   */
  useEffect(() => {
    setDraft(box);
    setConfirmDelete(false);
    setReviewing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box.id]);

  // Esc で閉じる。開いている間は背景を触らせない
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * 既にある枠は、触るたびに保存する（項目が少ないので保存を押させない）。
   * まだ無い枠は、保存を押すまで書き込まない。
   *
   * 以前は空きを押した瞬間に枠を作っていたので、間違って触っただけで
   * 「（未記入）」が残った。作るのは「この時間に入れる」を押したときだけ。
   */
  const patch = (over: Partial<TimeBox>) => {
    const next = { ...draft, ...over };
    setDraft(next);
    if (!isNew) onSave(next);
  };

  const patchMeta = (over: Partial<TimeBox["meta"]>) =>
    patch({ meta: { ...draft.meta, ...over } });

  function setRange(start: string, end: string) {
    patch(normalizeRange(start, end));
  }

  function uncomplete() {
    // 振り返りは消さない。やり直しても書いたものは残す
    patch({ completedAt: null });
    setReviewing(false);
  }

  const done = Boolean(draft.completedAt);
  const mins = durationMin(draft);
  /*
   * 習慣から自動で並んでいる枠か。
   * まだ実体になっていないので、この1件だけを消すことはできない
   * （消しても、次に開いたときに習慣からまた起きてくる）。
   */
  const fromHabit = !isNew && isGhost(draft);
  const hasMeta = Boolean(
    draft.meta.why || draft.meta.obstacle || draft.meta.counter,
  );

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-ink/25"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="予定"
        className="relative flex max-h-[92vh] flex-col rounded-t-2xl border-t border-line bg-paper"
      >
        {reviewing ? (
          <div className="phone overflow-y-auto px-5 pb-8 pt-4">
            <Review
              draft={draft}
              onChange={(review) => patch({ review })}
              onDone={() => {
                setReviewing(false);
                onClose();
              }}
            />
          </div>
        ) : (
          <>
            {/*
              見出し。閉じるボタンをここに置く。
              背景を押せば閉じるようにはしてあるが、シートが画面の9割を
              覆っているので、押せる背景が上の数十pxしか残っていなかった
            */}
            <div className="phone flex shrink-0 items-center gap-2 px-4 pt-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                {isNew ? "新しい予定" : fromHabit ? "習慣の予定" : "予定"}
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="閉じる"
                className="ml-auto flex h-11 w-11 items-center justify-center rounded-full text-[18px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                ✕
              </button>
            </div>

            {/* 中身。長くなってもここだけがスクロールする */}
            <div className="phone min-h-0 flex-1 overflow-y-auto px-4 pb-3">
              {/* 時間 */}
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  step={900}
                  value={draft.start}
                  onChange={(e) => setRange(e.target.value, draft.end)}
                  className="min-h-11 rounded-lg border border-line bg-surface px-2.5 font-mono text-[15px]"
                  aria-label="開始時刻"
                />
                <span aria-hidden="true" className="text-muted">
                  〜
                </span>
                <input
                  type="time"
                  step={900}
                  value={draft.end}
                  onChange={(e) => setRange(draft.start, e.target.value)}
                  className="min-h-11 rounded-lg border border-line bg-surface px-2.5 font-mono text-[15px]"
                  aria-label="終了時刻"
                />
                <span className="ml-auto font-mono text-[11.5px] text-muted">
                  {humanDuration(mins)}
                </span>
              </div>

              {/* 何をやるか */}
              <input
                type="text"
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="何をやるか"
                maxLength={120}
                autoFocus={!draft.title}
                className="mt-3 min-h-12 w-full rounded-lg border border-line bg-surface px-3 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
                aria-label="何をやるか"
              />

              {/* どの目標か */}
              <div className="mt-3">
                <p className="mb-1 text-[11.5px] text-muted">どの目標のためか</p>
                <select
                  value={draft.cardId ?? ""}
                  onChange={(e) => patch({ cardId: e.target.value || null })}
                  className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-[14px]"
                  aria-label="紐づける目標"
                >
                  <option value="">（紐づけない）</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {goalCardLabel(c)}
                    </option>
                  ))}
                </select>
              </div>

              {/*
                色。既定では目標ごとに自動で決まる。
                予定を作るたびに色を選ばせるのは手数なので、選ぶのは任意にする。
              */}
              <div className="mt-3">
                <p className="mb-1.5 text-[11.5px] text-muted">
                  色{!draft.color && "（目標に合わせて自動）"}
                </p>
                <div className="flex gap-1.5">
                  {BOX_COLORS.map((c) => {
                    const on = colorOf(draft) === c;
                    const picked = draft.color === c;
                    return (
                      <button
                        key={c}
                        type="button"
                        aria-label={COLOR_LABEL[c]}
                        aria-pressed={picked}
                        onClick={() => patch({ color: picked ? null : c })}
                        style={{
                          background: `var(--c-${c}-bg)`,
                          borderColor: on ? `var(--c-${c}-fg)` : `var(--c-${c}-line)`,
                        }}
                        className={`h-11 flex-1 rounded-lg border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                          on ? "ring-1 ring-inset" : ""
                        }`}
                      />
                    );
                  })}
                </div>
                {draft.color && (
                  <button
                    type="button"
                    onClick={() => patch({ color: null })}
                    className="mt-1 min-h-11 text-[12.5px] text-muted"
                  >
                    目標に合わせる
                  </button>
                )}
              </div>

              {/*
                メタ認知。先に書いておいて、時間が来たら読む。
                空のときは畳んでおく（3つ並ぶと主操作が画面の外へ出る）
              */}
              <details
                open={hasMeta}
                className="mt-4 rounded-xl border border-line bg-surface px-3.5"
              >
                <summary className="flex min-h-12 cursor-pointer items-center font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                  始める前に決めておく
                  {!hasMeta && (
                    <span className="ml-2 normal-case tracking-normal">（任意）</span>
                  )}
                </summary>
                <div className="pb-3">
                  <Field
                    label="なぜそれが重要か"
                    value={draft.meta.why}
                    onChange={(v) => patchMeta({ why: v })}
                  />
                  <Field
                    label="何が障害か"
                    value={draft.meta.obstacle}
                    onChange={(v) => patchMeta({ obstacle: v })}
                    placeholder="例: 動画を見た流れで別のことを始めてしまう"
                  />
                  <Field
                    label="対策は"
                    value={draft.meta.counter}
                    onChange={(v) => patchMeta({ counter: v })}
                    placeholder="例: 動画を見た瞬間にタイマーをかける"
                  />
                </div>
              </details>

              {/*
                完了まわり。消すのは下の主操作の並びへ移した
                （「閉じる」の直前に置きたい、という求めに合わせている）
              */}
              {!isNew && (
                <div className="mt-3 flex flex-col gap-2">
                  {done && (
                    <>
                      <div className="rounded-lg border border-accent-line bg-accent-soft px-3 py-2.5 text-[13px] text-accent">
                        完了しました（
                        {new Date(draft.completedAt as string).toLocaleTimeString(
                          "ja-JP",
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                        ）
                        {draft.review?.score != null && (
                          <span className="ml-1">・できばえ {draft.review.score}%</span>
                        )}
                      </div>
                      {/*
                        振り返りの入口。以前は下の主操作の位置にあったが、
                        そこは「閉じる」に譲ったので、完了の説明のすぐ下へ移す
                      */}
                      <button
                        type="button"
                        onClick={() => setReviewing(true)}
                        className="min-h-11 rounded-xl border border-line bg-surface px-4 text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        振り返りを書く / 直す
                      </button>
                      <button
                        type="button"
                        onClick={uncomplete}
                        className="min-h-11 rounded-xl border border-line bg-surface px-4 text-[13.5px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        完了を取り消す
                      </button>
                    </>
                  )}

                  {fromHabit && (
                    <p className="rounded-lg border border-line bg-surface px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
                      この予定は習慣から自動で並んでいます。時刻や曜日を変えるなら
                      習慣そのものを、この日だけ動かすならドラッグしてください。
                    </p>
                  )}
                </div>
              )}
            </div>

            {/*
              主操作。中身がどれだけ長くなっても、ここは必ず見えている。
              以前は入力欄3つに押されて、完了ボタンが画面の外に出ていた
            */}
            <div
              className="phone shrink-0 border-t border-line bg-paper px-4 pt-3"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
            >
              {isNew ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-[52px] flex-1 rounded-xl border border-line bg-surface px-4 text-[14px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    やめる
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onSave(draft);
                      onClose();
                    }}
                    className="min-h-[52px] flex-[2] rounded-xl bg-indigo px-4 text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    この時間に入れる
                  </button>
                </div>
              ) : (
                /*
                  既にある予定は、触るたびに保存されている（patch が onSave を
                  呼ぶ）。だから主操作は「決定」ではなく「閉じる」でよい。
                  完了はホーム画面の一覧と、時間割の「いまの時間」バーから押せる。

                  消すのはその直前に置く。取り返しがつかない操作なので、
                  色は赤にして、面は張らない（押しやすさで閉じるに勝たせない）。
                */
                <div className="flex flex-col gap-2">
                  {!fromHabit &&
                    (confirmDelete ? (
                      <div className="rounded-lg border border-line bg-surface px-3 py-2.5">
                        <p className="text-[12.5px] leading-relaxed">
                          この予定を消します。振り返りも一緒に消えます。
                        </p>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => onDelete(draft.id)}
                            className="min-h-11 flex-1 rounded-lg border border-[var(--c-rose-line)] bg-[var(--c-rose-bg)] px-3 text-[13px] text-[var(--c-rose-fg)]"
                          >
                            消す
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(false)}
                            className="min-h-11 flex-1 rounded-lg border border-line px-3 text-[13px] text-muted"
                          >
                            やめる
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(true)}
                        className="min-h-11 rounded-xl px-4 text-[13.5px] text-[var(--c-rose-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        この予定を消す
                      </button>
                    ))}
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-[52px] w-full rounded-xl bg-indigo px-4 text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    閉じる
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 終わったあとの振り返り。3つとも任意 */
function Review({
  draft,
  onChange,
  onDone,
}: {
  draft: TimeBox;
  onChange: (r: TimeBox["review"]) => void;
  onDone: () => void;
}) {
  const r = draft.review ?? emptyReview();
  // 古いデータには score キー自体が無い（あとから足した項目のため）
  const score = r.score ?? null;
  const set = (over: Partial<NonNullable<TimeBox["review"]>>) =>
    onChange({ ...r, ...over });

  return (
    <>
      <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
        振り返り
      </p>
      <h2 className="mt-1 font-serif text-[17px] leading-[1.5] font-bold">
        {draft.title || "（未記入）"}
      </h2>
      <p className="mt-1 font-mono text-[11.5px] text-muted">
        {draft.start}〜{draft.end}
      </p>

      {/*
        できばえ。絶対評価ではなく「自分の中の最高の出来を100%としたら」の
        相対評価にしてある。毎回の絶対点だと基準がぶれて比較にならない
      */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[11.5px] text-muted">
            できばえ（最高の出来を100%として）
          </span>
          <span className="font-mono text-[13px] text-muted">
            {score === null ? "未入力" : `${score}%`}
          </span>
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {[0, 25, 50, 75, 100].map((v) => {
            const on = score === v;
            return (
              <button
                key={v}
                type="button"
                aria-label={`できばえ ${v}%`}
                aria-pressed={on}
                onClick={() => set({ score: on ? null : v })}
                className={`min-h-11 flex-1 rounded-lg border-2 font-mono text-[12.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  on
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-surface text-muted"
                }`}
              >
                {v}
              </button>
            );
          })}
        </div>
      </div>

      <Field label="よかったこと" value={r.good} onChange={(v) => set({ good: v })} />
      <Field label="悪かったこと" value={r.bad} onChange={(v) => set({ bad: v })} />
      <Field
        label="今後の対策"
        value={r.next}
        onChange={(v) => set({ next: v })}
        placeholder="次に同じ時間帯が来たとき、どうするか"
      />

      <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
        すべて任意です。書かなくても完了は記録されます。
      </p>

      <button
        type="button"
        onClick={onDone}
        className="mt-3 min-h-[52px] w-full rounded-xl bg-indigo px-4 text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        閉じる
      </button>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="mt-3 block">
      <span className="mb-1 block text-[11.5px] text-muted">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        maxLength={500}
        className="w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-[13.5px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
      />
    </label>
  );
}
