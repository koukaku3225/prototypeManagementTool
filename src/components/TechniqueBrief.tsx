"use client";

import { useState } from "react";
import { EVIDENCE_CAVEAT, techniquesFor, type Technique } from "@/lib/techniques";

/**
 * 対話に入る前に手の内を明かす。
 * 何のために聞かれているのか分からないまま質問が続くと、
 * 「どこに向かうのか」を見失う。
 */
export function TechniqueBrief({ ids }: { ids: string[] }) {
  const items = techniquesFor(ids);
  const [openId, setOpenId] = useState<string | null>(null);

  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-line bg-surface px-4 py-4">
      <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
        使う手法
      </h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
        思いつきで質問しているわけではなく、次の考え方に沿って進めます。
        名前をタップすると、何をするのか・なぜ効くのかが読めます。
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {items.map((t) => (
          <TechniqueRow
            key={t.id}
            technique={t}
            open={openId === t.id}
            onToggle={() => setOpenId(openId === t.id ? null : t.id)}
          />
        ))}
      </ul>

      <p className="mt-3 border-t border-line-soft pt-2.5 text-[11px] leading-relaxed text-muted">
        {EVIDENCE_CAVEAT}
      </p>
    </section>
  );
}

function TechniqueRow({
  technique: t,
  open,
  onToggle,
}: {
  technique: Technique;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          open ? "border-accent-line bg-accent-soft" : "border-line bg-paper"
        }`}
      >
        <span className="block text-[13px] font-bold">{t.name}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
          {t.short}
        </span>
      </button>

      {open && (
        <dl className="mt-1.5 flex flex-col gap-2 rounded-lg bg-paper px-3 py-2.5">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              何をするか
            </dt>
            <dd className="mt-0.5 text-[12.5px] leading-relaxed">{t.what}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              なぜ効くか
            </dt>
            <dd className="mt-0.5 text-[12.5px] leading-relaxed">{t.why}</dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">
              根拠
            </dt>
            <dd className="mt-0.5 text-[12px] leading-relaxed text-muted">
              {t.evidence}
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              使うところ
            </dt>
            <dd className="mt-0.5 text-[12px] leading-relaxed text-muted">
              {t.usedIn}
            </dd>
          </div>
        </dl>
      )}
    </li>
  );
}
