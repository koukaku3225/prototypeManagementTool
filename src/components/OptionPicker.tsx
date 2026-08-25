"use client";

import { useEffect, useRef, useState } from "react";

/** 3案の観点。プロンプト側の並び順と対応している */
const ANGLE_LABELS = ["言葉に忠実", "情景として", "価値観を前に"];

/**
 * 整理された案から本人に選んでもらう。
 *
 * AIが1案に絞ってしまうと、丸められた言い方が本人の言葉を置き換えてしまう。
 * 観点の違う案を並べて、どれが自分の感覚に近いかを本人に決めさせる。
 * どれもしっくり来なければ自分で書ける。
 */
export function OptionPicker({
  label,
  hint,
  options,
  value,
  onChange,
  multiline,
}: {
  label: string;
  hint?: string;
  options: string[];
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
}) {
  const custom = value !== "" && !options.includes(value);
  const [writing, setWriting] = useState(custom);
  const [draft, setDraft] = useState(custom ? value : "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (writing) ref.current?.focus();
  }, [writing]);

  return (
    <section className="rounded-xl border border-line bg-surface px-4 py-4">
      <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
        {label}
      </h2>
      {hint && (
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted">{hint}</p>
      )}

      <div className="mt-2.5 flex flex-col gap-2" role="radiogroup" aria-label={label}>
        {options.map((opt, i) => {
          const on = !writing && value === opt;
          return (
            <button
              key={`${i}-${opt.slice(0, 12)}`}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                setWriting(false);
                onChange(opt);
              }}
              className={`rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                on
                  ? "border-accent-line bg-accent-soft"
                  : "border-line bg-paper hover:border-accent-line/60"
              }`}
            >
              <span className="flex items-baseline gap-2">
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.1em] ${
                    on ? "text-accent" : "text-muted"
                  }`}
                >
                  案{i + 1}
                </span>
                <span className="text-[10.5px] text-muted">
                  {ANGLE_LABELS[i] ?? ""}
                </span>
              </span>
              <span className="mt-1 block text-[13.5px] leading-relaxed">
                {opt}
              </span>
            </button>
          );
        })}

        {/* その他（自由記述） */}
        <button
          type="button"
          role="radio"
          aria-checked={writing}
          onClick={() => {
            setWriting(true);
            if (draft) onChange(draft);
          }}
          className={`rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            writing
              ? "border-accent-line bg-accent-soft"
              : "border-line bg-paper hover:border-accent-line/60"
          }`}
        >
          <span
            className={`font-mono text-[10px] uppercase tracking-[0.1em] ${
              writing ? "text-accent" : "text-muted"
            }`}
          >
            自分で書く
          </span>
          {!writing && (
            <span className="mt-1 block text-[12.5px] leading-relaxed text-muted">
              どれも違うと感じたら、こちら
            </span>
          )}
        </button>
      </div>

      {writing && (
        <textarea
          ref={ref}
          value={draft}
          rows={multiline ? 4 : 2}
          onChange={(e) => {
            setDraft(e.target.value);
            onChange(e.target.value);
          }}
          placeholder="あなたの言葉で書いてください"
          aria-label={`${label}を自分で書く`}
          className="mt-2 w-full resize-none rounded-lg border border-accent-line bg-paper px-3 py-2 text-[13.5px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
        />
      )}
    </section>
  );
}
