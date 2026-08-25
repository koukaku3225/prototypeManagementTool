"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CoachAvatar } from "@/components/CoachAvatar";
import { COACHES } from "@/lib/prompts/coaches";
import { loadArchive, loadSession } from "@/lib/storage";
import type { Session } from "@/types/goal";

/** 対話の一覧。終わったものも、途中のものも時系列で並べる。 */
export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const archived = loadArchive();
    const current = loadSession();
    // 続きから話している最中は同じIDが両方にある。進行中のほうが新しい
    const all = current
      ? [...archived.filter((s) => s.id !== current.id), current]
      : archived;
    // 新しいものが上
    setSessions(all.sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <>
        <AppHeader title="対話の記録" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  return (
    <>
      <AppHeader title="対話の記録" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        {sessions.length === 0 ? (
          <p className="mt-10 text-center text-[14px] leading-relaxed text-muted">
            まだ対話の記録がありません。
            <br />
            <Link href="/" className="underline">
              ホームへ戻る
            </Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => {
              const coach = COACHES[s.coachId];
              const userTurns = s.messages.filter((m) => m.role === "user").length;
              const firstUser = s.messages.find((m) => m.role === "user");
              return (
                <li key={s.id}>
                  <Link
                    href={`/history/${s.id}`}
                    className="block rounded-xl border border-line bg-surface px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <div className="flex items-start gap-3">
                      <CoachAvatar
                        id={s.coachId}
                        size={30}
                        className="mt-0.5 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="text-[13px] font-medium">
                            {coach?.name ?? "コーチ"}
                          </span>
                          <span className="font-mono text-[10.5px] text-muted">
                            {s.mode === "big" ? "大きな物語" : "目標"}
                          </span>
                          {!s.completedAt && (
                            <span className="ml-auto rounded-full border border-accent-line px-2 py-0.5 text-[10.5px] text-accent">
                              途中
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed">
                          {firstUser
                            ? truncate(firstUser.content, 42)
                            : "（まだ発言がありません）"}
                        </p>
                        <p className="mt-1 font-mono text-[10.5px] text-muted">
                          {new Date(s.startedAt).toLocaleString("ja-JP")} ・
                          {userTurns}往復
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
