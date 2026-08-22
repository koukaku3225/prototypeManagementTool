"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatBubble } from "@/components/ChatBubble";
import { Composer } from "@/components/Composer";
import { DelayLock } from "@/components/DelayLock";
import { PhaseProgress } from "@/components/PhaseProgress";
import { useConversation } from "@/hooks/useConversation";
import { COACHES } from "@/lib/prompts/coaches";
import { PHASE_META } from "@/lib/prompts/phases";
import { loadSession } from "@/lib/storage";
import type { PhaseId, Session } from "@/types/goal";

export default function SessionPage() {
  const router = useRouter();
  const [initial, setInitial] = useState<Session | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const s = loadSession();
    if (s) setInitial(s);
    else setMissing(true);
  }, []);

  if (missing) {
    return (
      <main className="phone flex flex-1 flex-col items-center justify-center gap-4 px-5">
        <p className="text-[14px] text-muted">対話が見つかりませんでした。</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-xl bg-indigo px-5 py-3 text-[14px] text-surface"
        >
          最初から始める
        </button>
      </main>
    );
  }

  if (!initial) {
    return <main className="phone flex-1 px-5 py-10" aria-busy="true" />;
  }

  return <Conversation initial={initial} />;
}

function Conversation({ initial }: { initial: Session }) {
  const router = useRouter();
  const conv = useConversation(initial);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [, forceTick] = useState(0);

  const { session, streamingText, status, error, lockUntil } = conv;
  const coach = COACHES[session.coachId];

  // 初回だけコーチから話しかける
  const started = useRef(false);
  useEffect(() => {
    if (!started.current && session.messages.length === 0) {
      started.current = true;
      void conv.send(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.messages.length, streamingText]);

  useEffect(() => {
    if (status === "done") {
      const dest = session.mode === "big" ? "/big" : "/card";
      const t = setTimeout(() => router.push(dest), 1200);
      return () => clearTimeout(t);
    }
  }, [status, router, session.mode]);

  const locked = lockUntil !== null && Date.now() < lockUntil;

  return (
    <div className="phone flex flex-1 flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-paper/95 px-5 py-3 backdrop-blur">
        <button
          type="button"
          onClick={() => router.push("/")}
          aria-label="戻る"
          className="text-[18px] leading-none text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ←
        </button>
        <span className="text-[14px] font-medium">{coach.name}</span>
        <div className="ml-auto">
          {session.mode === "small" && (
            <PhaseProgress current={session.currentPhase as PhaseId} />
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3.5 px-5 py-5">
        {session.messages.map((m, i) => {
          const prev = i > 0 ? session.messages[i - 1] : null;
          const crossed = prev !== null && prev.phase !== m.phase;
          return (
            <div key={`${m.timestamp}-${i}`} className="flex flex-col gap-3.5">
              {crossed && <PhaseDivider note={PHASE_META[m.phase].transitionNote} />}
              <ChatBubble
                role={m.role}
                content={m.content}
                coachId={session.coachId}
              />
            </div>
          );
        })}

        {status === "streaming" && (
          <ChatBubble
            role="assistant"
            content={streamingText}
            coachId={session.coachId}
            pending
          />
        )}

        {status === "done" && (
          <p className="py-4 text-center text-[13px] text-muted">
            あなたの言葉を整理しています…
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 flex flex-col gap-2.5 border-t border-line bg-paper/95 px-5 py-3 backdrop-blur">
        {error && (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface px-3.5 py-2.5">
            <p className="flex-1 text-[12.5px] text-muted">{error}</p>
            <button
              type="button"
              onClick={conv.retry}
              className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              もう一度送る
            </button>
          </div>
        )}

        {locked && lockUntil && (
          <DelayLock until={lockUntil} onExpire={() => forceTick((n) => n + 1)} />
        )}

        <Composer
          disabled={status === "streaming" || status === "done"}
          locked={locked}
          lockStartedAt={lockUntil !== null ? lockUntil - 60_000 : null}
          onSend={(text, draft) => void conv.send(text, draft)}
        />
      </div>
    </div>
  );
}

/** フェーズが変わった位置に残る区切り。リロードしても消えない。 */
function PhaseDivider({ note }: { note: string }) {
  if (!note) return null;
  return (
    <div className="my-1 flex items-center gap-3">
      <span className="h-px flex-1 bg-line" />
      <span className="text-[11.5px] leading-relaxed text-muted">{note}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
