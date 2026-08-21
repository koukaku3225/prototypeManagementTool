import type { CoachId } from "@/types/goal";
import { COACHES } from "@/lib/prompts/coaches";

export function ChatBubble({
  role,
  content,
  coachId,
  pending,
}: {
  role: "user" | "assistant";
  content: string;
  coachId: CoachId;
  pending?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-indigo px-4 py-2.5 text-[14px] leading-relaxed text-surface whitespace-pre-wrap">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted">{COACHES[coachId].name}</span>
      <div className="max-w-[88%] rounded-2xl rounded-bl-sm border border-line bg-surface px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap">
        {content}
        {pending && (
          <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-[2px] animate-pulse bg-accent" />
        )}
      </div>
    </div>
  );
}
