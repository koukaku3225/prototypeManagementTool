import { FLOW, PHASE_TURN_LIMIT, type AnyPhaseId, type PhaseId, type StoryMode } from "@/types/goal";
import { PHASE_META } from "@/lib/prompts/phases";

/**
 * 今どのステップにいて、あと何問くらいで終わるかを常に見せる。
 *
 * 以前はドットと番号だけでフェーズ名を伏せていた（構えさせないため）が、
 * 実使用で「どこに向かうつもりなのか分からない」「いつまで続くのか」という
 * 声が出たため、名前と残り問数を明示する方針に変えた。
 */
export function PhaseProgress({
  mode,
  current,
  turnsInPhase,
}: {
  mode: StoryMode;
  current: AnyPhaseId;
  turnsInPhase: number;
}) {
  const order = FLOW[mode];
  const index = order.indexOf(current);
  if (index === -1) return null;

  const label = PHASE_META[current]?.label ?? "";
  const limit = mode === "small" ? PHASE_TURN_LIMIT[current as PhaseId] : null;
  // 1ターン目は問いかけ自体が消費するので、残りの「ユーザーが答える回数」に直す
  const left = limit === null ? null : Math.max(0, limit - turnsInPhase);

  return (
    <div
      className="flex items-center gap-2"
      aria-label={`${order.length}ステップ中 ${index + 1} ステップ目: ${label}`}
    >
      <div className="flex gap-1" aria-hidden="true">
        {order.map((p, i) => (
          <span
            key={p}
            className={`h-1.5 w-4 rounded-full transition-colors ${
              i < index ? "bg-indigo" : i === index ? "bg-accent" : "bg-line"
            }`}
          />
        ))}
      </div>
      <span className="text-[11px] tabular-nums text-muted">
        {index + 1}/{order.length}
      </span>
      <span className="text-[11px] text-muted">{label}</span>
      {left !== null && left > 0 && (
        <span className="text-[11px] tabular-nums text-muted">・あと約{left}問</span>
      )}
    </div>
  );
}
