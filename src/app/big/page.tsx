"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import {
  archiveSession,
  clearSession,
  loadSession,
  saveBigStory,
  saveProfile,
} from "@/lib/storage";
import type { BigStory, Session } from "@/types/goal";

/**
 * big モードの対話を大きな物語に整えるだけの画面。
 * 表示と編集は /story に集約する（編集口を2つ持つと片方だけ穴が空く）。
 */
export default function BigStoryGenPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Session | null>(null);
  const ran = useRef(false);

  const generate = useCallback(
    async (session: Session, isRetry: boolean) => {
      setError(null);
      try {
        const res = await fetch("/api/structure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "big",
            messages: session.messages,
            coachId: session.coachId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message ?? "整理に失敗しました。");

        const now = new Date().toISOString();
        const built: BigStory = {
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          coachId: session.coachId,
          horizonYears: data.bigStory.horizonYears,
          vision: data.bigStory.vision,
          values: data.bigStory.values,
          currentPosition: data.bigStory.currentPosition,
          milestones: data.bigStory.milestones ?? [],
          editedFields: [],
          sessionId: session.id,
        };

        saveBigStory(built);
        saveProfile({
          updatedAt: now,
          lifePatterns: data.profile.lifePatterns,
          pastFailures: data.profile.pastFailures,
          valuesAccumulated: data.profile.valuesAccumulated,
          communicationStyle: {
            avgResponseLength: avgUserLength(session),
            prefersConcrete: avgUserLength(session) < 40,
          },
        });

        archiveSession(session);
        clearSession();
        router.replace("/story");
      } catch (err) {
        if (!isRetry) return generate(session, true);
        setError(err instanceof Error ? err.message : "整理に失敗しました。");
      }
    },
    [router],
  );

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const session = loadSession();
    if (!session || session.mode !== "big" || session.messages.length === 0) {
      setError("大きな物語の対話が見つかりませんでした。");
      return;
    }
    setTranscript(session);
    void generate(session, false);
  }, [generate]);

  if (!error) {
    return (
      <>
        <AppHeader />
        <main className="phone flex flex-1 flex-col items-center justify-center gap-3 px-5">
          <div className="flex gap-1.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-2 w-2 animate-pulse rounded-full bg-accent"
                style={{ animationDelay: `${i * 160}ms` }}
              />
            ))}
          </div>
          <p className="text-[13px] text-muted" aria-live="polite">
            あなたの言葉を整理しています…
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <main className="phone flex flex-1 flex-col gap-4 px-5 py-10">
        <h1 className="font-serif text-[20px] font-bold">整理できませんでした</h1>
        <p className="text-[14px] leading-relaxed text-muted">{error}</p>
        {transcript && (
          <button
            type="button"
            onClick={() => void generate(transcript, false)}
            className="rounded-xl bg-indigo px-4 py-3 text-[14px] text-surface"
          >
            もう一度試す
          </button>
        )}
        <Link href="/" className="text-[13px] text-muted underline">
          ホームへ戻る
        </Link>
      </main>
    </>
  );
}

function avgUserLength(session: Session): number {
  const userMsgs = session.messages.filter((m) => m.role === "user");
  if (userMsgs.length === 0) return 0;
  return Math.round(
    userMsgs.reduce((sum, m) => sum + m.content.length, 0) / userMsgs.length,
  );
}
