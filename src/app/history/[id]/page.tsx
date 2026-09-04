"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { ChatBubble } from "@/components/ChatBubble";
import { CoachAvatar } from "@/components/CoachAvatar";
import { COACHES } from "@/lib/prompts/coaches";
import { PHASE_META } from "@/lib/prompts/phases";
import { download } from "@/lib/export";
import {
  loadArchivedSession,
  loadSession,
  outcomeOfSession,
  resumeArchivedSession,
} from "@/lib/storage";
import { FLOW, type Session } from "@/types/goal";

/** 1件の対話を読み返し、必要なら続きから話す。 */
export default function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  /** 別の対話が進行中なら、上書きになるので一度確認する */
  const [conflict, setConflict] = useState<Session | null>(null);

  useEffect(() => {
    setSession(loadArchivedSession(id));
    setReady(true);
  }, [id]);

  function resume() {
    const current = loadSession();
    if (current && current.id !== id && !current.completedAt && current.messages.length > 0) {
      setConflict(current);
      return;
    }
    doResume();
  }

  function doResume() {
    if (!resumeArchivedSession(id)) return;
    router.push("/session");
  }

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
  const { card, big } = outcomeOfSession(session.id);
  const outcome = card ?? big;

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

        {/* 続きから話す */}
        <section className="mt-8 rounded-xl border border-accent-line bg-accent-soft px-4 py-4">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-accent">
            続きから話す
          </h2>
          <p className="mt-1.5 text-[12.5px] leading-relaxed">
            この対話を現役に戻して、同じコーチと続きを話せます。
            {outcome && "話し終えたら、この対話から作った内容が更新されます。"}
          </p>

          {conflict ? (
            <div className="mt-3 rounded-lg border border-line bg-paper px-3 py-2.5">
              <p className="text-[12.5px] leading-relaxed">
                いま別の対話が進行中です。続きを始めると、そちらは記録に残したうえで
                置き換わります。
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={doResume}
                  className="rounded-md bg-indigo px-3 py-1.5 text-[12.5px] text-surface"
                >
                  それでも続きから話す
                </button>
                <button
                  type="button"
                  onClick={() => setConflict(null)}
                  className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-muted"
                >
                  やめる
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={resume}
              className="mt-3 w-full rounded-lg bg-indigo px-4 py-2.5 text-[14px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              この続きから話す →
            </button>
          )}
        </section>

        <Link
          href="/history"
          className="mt-3 rounded-xl border border-line bg-surface px-4 py-3 text-center text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
