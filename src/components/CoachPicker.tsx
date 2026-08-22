"use client";

import { CoachAvatar } from "@/components/CoachAvatar";
import { COACH_LIST } from "@/lib/prompts/coaches";
import type { CoachId } from "@/types/goal";

/**
 * コーチ選択。得意・苦手まで出すのは、合わない相手に当てないため。
 * 「厳しめ」を選んだのに落ち込んでいる、という組み合わせを避けたい。
 */
export function CoachPicker({
  value,
  onChange,
}: {
  value: CoachId;
  onChange: (id: CoachId) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {COACH_LIST.map((c) => {
        const on = value === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            aria-pressed={on}
            className={`rounded-xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              on ? "border-accent-line bg-accent-soft" : "border-line bg-surface"
            }`}
          >
            <div className="flex items-start gap-3">
              <CoachAvatar id={c.id} size={44} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[15px] font-bold">{c.name}</span>
                  <span className="text-[11px] text-muted">{c.tagline}</span>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                  「{c.sample}」
                </p>
                {on && (
                  <dl className="mt-2 flex flex-col gap-1 border-t border-line-soft pt-2 text-[11.5px] leading-relaxed">
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-accent">向く</dt>
                      <dd className="text-muted">{c.goodFor}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="shrink-0 text-muted">苦手</dt>
                      <dd className="text-muted">{c.weakAt}</dd>
                    </div>
                  </dl>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
