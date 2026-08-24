"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { ChatBubble } from "@/components/ChatBubble";
import { CoachAvatar } from "@/components/CoachAvatar";
import { COACHES } from "@/lib/prompts/coaches";
import { PHASE_META } from "@/lib/prompts/phases";
import { download } from "@/lib/export";
import { loadArchivedSession } from "@/lib/storage";
import { FLOW, type Session } from "@/types/goal";

/** 1件の対話をそのまま読み返す。 */
export default function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(loadArchivedSession(id));
    setReady(true);
  }, [id]);

  if (!ready) {
    return (
      <>
        <AppHeader title="対話の記録" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  if (!session) {
    return (
      <>
        <AppHeader title="対話の記録" />
        <main className="phone flex flex-1 flex-col items-center justify-center gap-4 px-5">
          <p className="text-[14px] text-muted">この対話は見つかりませんでした。</p>
          <Link href="/history" className="text-[13px] underline">
            一覧へ戻る
          </Link>
        </main>
      </>
    );
  }

  const coach = COACHES[session.coachId];
  const order = FLOW[session.mode];

  return (
    <>
      <AppHeader title="対話の記録" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        <div className="flex items-center gap-2.5">
          <CoachAvatar id={session.coachId} size={32} />
          <div className="min-w-0">
            <p className="text-[13px] font-medium">{coach?.name}</p>
            <p className="font-mono text-[10.5px] text-muted">
              {new Date(session.startedAt).toLocaleString("ja-JP")}
              {session.completedAt ? "" : " ・途中"}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              download(
                `chat-${session.startedAt.slice(0, 10)}.md`,
                toTranscript(session, coach?.name ?? "コーチ"),
                "text/markdown",
              )
            }
            className="ml-auto shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            書き出す
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3.5">
          {session.messages.map((m, i) => {
            const prev = i > 0 ? session.messages[i - 1] : null;
            const crossed = prev !== null && prev.phase !== m.phase;
            const stepNo = order.indexOf(m.phase) + 1;
            return (
              <div key={`${m.timestamp}-${i}`} className="flex flex-col gap-3.5">
                {(i === 0 || crossed) && (
                  <div className="my-1 flex items-center gap-3">
                    <span className="h-px flex-1 bg-line" />
                    <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted">
                      {stepNo > 0 ? `STEP ${stepNo}` : ""}{" "}
                      {PHASE_META[m.phase]?.label ?? ""}
                    </span>
                    <span className="h-px flex-1 bg-line" />
                  </div>
                )}
                <div className={m.invalidated ? "opacity-45" : ""}>
                  <ChatBubble
                    role={m.role}
                    content={m.content}
                    coachId={session.coachId}
                  />
                  {m.invalidated && (
                    <p className="mt-1 text-[10.5px] text-muted">
                      あとで編集され、やり直しになった部分です
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {session.messages.length === 0 && (
          <p className="mt-8 text-center text-[13px] text-muted">
            まだ発言がありません。
          </p>
        )}

        <Link
          href="/history"
          className="mt-8 rounded-xl border border-line bg-surface px-4 py-3 text-center text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ← 対話の一覧へ
        </Link>
      </main>
    </>
  );
}

function toTranscript(session: Session, coachName: string): string {
  const head = `# 対話の記録\n\n- 日時: ${new Date(session.startedAt).toLocaleString("ja-JP")}\n- コーチ: ${coachName}\n- 種別: ${session.mode === "big" ? "大きな物語" : "目標"}\n\n---\n`;
  const body = session.messages
    .map((m) => {
      const who = m.role === "user" ? "あなた" : coachName;
      const step = PHASE_META[m.phase]?.label ?? "";
      return `\n**${who}**（${step}）\n\n${m.content}\n`;
    })
    .join("");
  return head + body;
}
