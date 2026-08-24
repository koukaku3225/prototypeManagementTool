"use client";

import { useEffect, useState } from "react";
import { tipsFor, type Tip } from "@/lib/tips";
import type { AnyPhaseId } from "@/types/goal";

/**
 * 対話中に開ける「コツ」。
 * コーチが代わりに答えを作ってしまうと本人に何も残らないので、
 * 書き方だけ渡して本人に書いてもらうための導線。
 */
export function TipsBar({ phase }: { phase: AnyPhaseId }) {
  const tips = tipsFor(phase);
  const [openId, setOpenId] = useState<string | null>(null);

  // ステップが変わったら閉じる
  useEffect(() => setOpenId(null), [phase]);

  if (tips.length === 0) return null;
  const open = tips.find((t) => t.id === openId) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          コツ
        </span>
        {tips.map((t) => {
          const on = openId === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenId(on ? null : t.id)}
              aria-expanded={on}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                on
                  ? "border-accent-line bg-accent-soft text-accent"
                  : "border-line bg-surface text-muted"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {open && <TipPanel tip={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function TipPanel({ tip, onClose }: { tip: Tip; onClose: () => void }) {
  return (
    <section className="rounded-xl border border-accent-line bg-accent-soft px-4 py-3.5">
      <div className="flex items-start gap-3">
        <h3 className="flex-1 text-[13.5px] font-bold leading-relaxed">
          {tip.title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="コツを閉じる"
          className="shrink-0 text-[11.5px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          閉じる
        </button>
      </div>

      {tip.body.map((p, i) => (
        <p key={i} className="mt-2 text-[12.5px] leading-relaxed">
          {p}
        </p>
      ))}

      {tip.steps && (
        <ol className="mt-3 flex flex-col gap-1.5">
          {tip.steps.map((s, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed">
              <span className="shrink-0 font-mono text-accent">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      )}

      {tip.examples?.map((ex, i) => (
        <div
          key={i}
          className="mt-3 flex flex-col gap-2 rounded-lg bg-paper px-3 py-2.5"
        >
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
              よい例
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed">{ex.good}</p>
          </div>
          <div className="border-t border-line-soft pt-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              惜しい例
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted line-through decoration-line">
              {ex.bad}
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
              {ex.whyBad}
            </p>
          </div>
        </div>
      ))}
    </section>
  );
}
