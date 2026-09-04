"use client";

import { colorForCard, humanDuration, type CardShare } from "@/lib/timebox";
import type { GoalCard } from "@/types/goal";

/**
 * 今週の時間が、どの目標に流れたか。
 *
 * 数字を並べるより、1本のバーにしたほうが「どれが太いか」が一目で分かる。
 * ただし本命は太さではなく空白のほうで、
 * 「今週この目標に一度も触れていない」を形で見せることを狙っている。
 * 触れていない目標はバーに出ようがないので、下に別立てで並べる。
 *
 * 色は時間割の枠と同じ規則（colorForCard）で決める。
 * 画面をまたいで同じ目標が同じ色になっていないと、対応づけに頭を使う。
 */
export function WeekShareBar({
  shares,
  cards,
  totalMin,
}: {
  shares: CardShare[];
  /** 表示中の目標。バーに出ない＝今週ゼロ、を出すために全件受け取る */
  cards: GoalCard[];
  totalMin: number;
}) {
  const titleOf = (id: string) => {
    const c = cards.find((x) => x.id === id);
    return c ? c.vision.refined || c.vision.raw || "（未記入の目標）" : "削除された目標";
  };

  const touched = new Set(shares.map((s) => s.cardId));
  const untouched = cards.filter((c) => !touched.has(c.id));

  if (totalMin === 0) {
    return (
      <section className="rounded-xl border border-dashed border-line px-4 py-4">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          今週の時間
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          今週はまだ記録がありません。時間割に予定を入れると、
          どの目標にどれだけ使ったかがここに出ます。
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-surface px-4 py-4">
      <div className="flex items-baseline gap-2">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          今週の時間
        </h2>
        <span className="ml-auto font-mono text-[12px] text-muted">
          {humanDuration(totalMin)}
        </span>
      </div>

      {/* バー本体 */}
      <div
        className="mt-2.5 flex h-3 w-full overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`今週の時間の内訳。${shares
          .map(
            (s) =>
              `${s.cardId ? titleOf(s.cardId) : "目標に紐づかない予定"} ${humanDuration(s.minutes)}`,
          )
          .join("、")}`}
      >
        {shares.map((s) => (
          <span
            key={s.cardId ?? "__none__"}
            style={{
              width: `${s.ratio * 100}%`,
              background: s.cardId
                ? `var(--c-${colorForCard(s.cardId)}-line)`
                : "var(--c-slate-line)",
            }}
          />
        ))}
      </div>

      {/* 内訳 */}
      <ul className="mt-3 flex flex-col gap-1.5">
        {shares.map((s) => (
          <li key={s.cardId ?? "__none__"} className="flex items-baseline gap-2">
            <span
              aria-hidden="true"
              className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{
                background: s.cardId
                  ? `var(--c-${colorForCard(s.cardId)}-line)`
                  : "var(--c-slate-line)",
              }}
            />
            <span className="min-w-0 flex-1 truncate text-[12.5px]">
              {s.cardId ? titleOf(s.cardId) : "目標に紐づかない予定"}
            </span>
            <span className="shrink-0 font-mono text-[11.5px] text-muted">
              {humanDuration(s.minutes)}
            </span>
          </li>
        ))}
      </ul>

      {/*
        本命。責める文言にはしない（「サボっている」ではなく事実だけ）。
        外から評価されている感じが強くなると、続ける動機そのものを削る
      */}
      {untouched.length > 0 && (
        <div className="mt-3 border-t border-line-soft pt-2.5">
          <p className="text-[12px] text-muted">今週まだ時間を使っていない目標</p>
          {/*
            目標のタイトルは短いラベルではなく理想を書いた一文なので、
            そのまま並べると数行になって、肝心の「使っていない」が埋もれる。
            1行に抑えて、全文は title 属性に持たせる
          */}
          <ul className="mt-1 flex flex-col gap-0.5">
            {untouched.map((c) => (
              <li
                key={c.id}
                title={titleOf(c.id)}
                className="flex items-baseline gap-2 text-[12.5px]"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-sm border border-line bg-surface-2"
                />
                <span className="min-w-0 flex-1 truncate">{titleOf(c.id)}</span>
                <span className="shrink-0 font-mono text-[11.5px] text-muted">0分</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
