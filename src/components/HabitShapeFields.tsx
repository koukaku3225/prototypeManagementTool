"use client";

import { useEffect, useState } from "react";
import { EditableField } from "@/components/EditableField";
import {
  CELEBRATION_PRESETS,
  FRICTION_CHOICES,
  frictionAdvice,
  minimalSizeCheck,
  shrinkOptions,
} from "@/lib/habit-shape";

/**
 * 習慣の「作る形」の入力部品（D1 習慣の型・D2 2分チェック・D4 摩擦の診断）。
 *
 * どれも任意で、1タップで済む。案内は押し付けない
 * （無視してそのまま保存できる。保存を止める処理は持たない）。
 */

/** ② 最小の行動。長そうなときは、その場で「もっと小さくしませんか」を出す */
export function MinimalField({
  n,
  value,
  onSave,
}: {
  n: number;
  value: string;
  onSave: (next: string) => void;
}) {
  // 書いている最中の文字を見て案内を出す（保存は欄を離れたとき。EditableField の約束）
  const [draft, setDraft] = useState(value);
  // 「このまま」を選んだ文字列。同じ文字列のあいだは出さない
  const [keep, setKeep] = useState<string | null>(null);

  useEffect(() => setDraft(value), [value]);

  const check = minimalSizeCheck(draft);
  const show = check.tooBig && keep !== draft.trim();

  function apply(next: string) {
    // タップした瞬間に入力欄を離す。欄が入力中のままだと、外から変えた値が反映されず、
    // あとで離れたときに書きかけが選んだ案を上書きしてしまう
    if (typeof document !== "undefined") {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    onSave(next);
    setDraft(next);
  }

  return (
    <div>
      <EditableField
        label={`習慣${n}の最小版`}
        value={value}
        onSave={onSave}
        onDraftChange={setDraft}
      />
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        2分以内に終わる大きさです。無理な日にゼロにするより、最小版でも続けたほうが途切れません。
      </p>

      {show && (
        <div
          role="note"
          aria-label={`習慣${n}の最小版について`}
          className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5"
        >
          <p className="text-[12.5px] leading-relaxed">
            {check.reason === "time"
              ? "この大きさは、疲れた日には重いかもしれません。"
              : "少し長めの書き方です。やる気のない日には重いかもしれません。"}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
            2分で終わる形だと、やる気のない日でも始められます。もっと小さくしませんか。
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {shrinkOptions(draft).map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => apply(o)}
                className="min-h-9 rounded-lg border border-accent-line bg-accent-soft px-2.5 text-[12px] text-accent"
              >
                「{o}」にする
              </button>
            ))}
            <button
              type="button"
              onClick={() => setKeep(draft.trim())}
              className="min-h-9 rounded-lg border border-line px-2.5 text-[12px] text-muted"
            >
              このまま
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** ③ そのあとの祝い。選択肢をタップするか、自由に書く。どちらも任意 */
export function CelebrationField({
  n,
  value,
  onChange,
}: {
  n: number;
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`習慣${n}の祝いの選択肢`}>
        {CELEBRATION_PRESETS.map((p) => {
          const on = value === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              // もう一度押すと外せる
              onClick={() => onChange(on ? null : p)}
              className={`min-h-9 rounded-lg border px-2.5 text-[12.5px] ${
                on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"
              }`}
            >
              {p}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        // 選択肢を選んだときは、上のボタンが選択状態を示す。ここには自分で書いたものだけを出す
        value={value && !(CELEBRATION_PRESETS as readonly string[]).includes(value) ? value : ""}
        placeholder="ほかの祝い（任意）"
        maxLength={60}
        onChange={(e) => onChange(e.target.value || null)}
        className="mt-2 w-full rounded-md border border-line bg-surface px-2.5 py-1 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
        aria-label={`習慣${n}の祝い`}
      />
    </div>
  );
}

/** 始めるまでの手順。3以上のときは、減らす案を出す */
export function FrictionField({
  n,
  value,
  onChange,
}: {
  n: number;
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  const advice = frictionAdvice(value);
  return (
    <div>
      <p className="mb-1.5 text-[11px] text-muted">始めるまでの手順は？</p>
      <div className="flex gap-1.5" role="group" aria-label={`習慣${n}の始めるまでの手順の数`}>
        {FRICTION_CHOICES.map((c) => {
          const on = value === c.value;
          return (
            <button
              key={c.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? null : c.value)}
              className={`min-h-9 flex-1 rounded-md border text-[12.5px] ${
                on ? "border-accent bg-accent text-surface" : "border-line text-muted"
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        手順は少ないほど続きます。例: 椅子に座る、ノートPCを開く、アプリを開く、で3つです。
      </p>
      {advice.heavy && (
        <p
          role="note"
          className="mt-1.5 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] leading-relaxed"
        >
          {advice.message}
        </p>
      )}
    </div>
  );
}
