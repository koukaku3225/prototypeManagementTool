import { PHASE_ORDER, type PhaseId } from "@/types/goal";

/** フェーズ番号は出すが、フェーズ名は出さない（構えさせないため） */
export function PhaseProgress({ current }: { current: PhaseId }) {
  const index = PHASE_ORDER.indexOf(current);

  return (
    <div className="flex items-center gap-2" aria-label={`5段階中 ${index + 1} 段階目`}>
      <div className="flex gap-1">
        {PHASE_ORDER.map((p, i) => (
          <span
            key={p}
            className={`h-1.5 w-4 rounded-full transition-colors ${
              i < index
                ? "bg-indigo"
                : i === index
                  ? "bg-accent"
                  : "bg-line"
            }`}
          />
        ))}
      </div>
      <span className="text-[11px] tabular-nums text-muted">
        {index + 1}/5
      </span>
    </div>
  );
}
