"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import {
  archiveSession,
  clearSession,
  loadBigStory,
  loadSession,
  upsertCard,
} from "@/lib/storage";
import type { GoalCard, Session } from "@/types/goal";

type Status = "loading" | "error";

/**
 * 対話の結果を目標カードに整えるだけの画面。
 *
 * 以前はここが表示と編集も兼ねていたが、/goal/[id] と二重になり、
 * こちら側だけ if-then とタスクが編集できないという穴があった。
 * 生成が終わったら編集できる詳細画面へ渡して、編集口は1つに保つ。
 */
export default function CardPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Session | null>(null);
  const ran = useRef(false);

  const generate = useCallback(
    async (session: Session, isRetry: boolean) => {
      setStatus("loading");
      setError(null);
      try {
        const big = loadBigStory();
        const res = await fetch("/api/structure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "small",
            messages: session.messages,
            coachId: session.coachId,
            bigStorySummary: big
              ? `理想像: ${big.vision.refined || big.vision.raw}\n大事にしているもの: ${big.values.join(" / ")}\n今の立ち位置: ${big.currentPosition}`
              : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message ?? "整理に失敗しました。");

        const now = new Date().toISOString();
        const tomorrow = new Date(Date.now() + 86_400_000)
          .toISOString()
          .slice(0, 10);

        const built: GoalCard = {
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          coachId: session.coachId,
          bigStoryId: big?.id ?? null,
          rationale: data.card.rationale ?? "",
          status: "active",
          source: "dialogue",
          sessionId: session.id,
          vision: data.card.vision,
          meaning: data.card.meaning,
          smart: { ...data.card.smart, deadline: data.card.smart.deadline ?? "" },
          woop: {
            ...data.card.woop,
            obstacles: (data.card.woop.obstacles ?? []).map(
              (o: GoalCard["woop"]["obstacles"][number]) => ({
                ...o,
                id: crypto.randomUUID(),
              }),
            ),
          },
          tasks: (data.card.tasks ?? [])
            .slice(0, 1)
            .map((t: { title: string; estimateMin: number }) => ({
              id: crypto.randomUUID(),
              title: t.title,
              estimateMin: t.estimateMin,
              dueDate: tomorrow,
              completedAt: null,
            })),
          commitment: {
            accepted: Boolean(data.card.commitment?.userWords),
            acceptedAt: data.card.commitment?.userWords ? now : null,
            userWords: data.card.commitment?.userWords ?? null,
          },
          editedFields: [],
        };

        upsertCard(built);
        // 計測データを残してから対話を片付ける
        archiveSession(session);
        clearSession();
        router.replace(`/goal/${built.id}`);
      } catch (err) {
        if (!isRetry) return generate(session, true);
        setError(err instanceof Error ? err.message : "整理に失敗しました。");
        setStatus("error");
      }
    },
    [router],
  );

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const session = loadSession();
    if (!session || session.messages.length === 0) {
      setError("対話が見つかりませんでした。");
      setStatus("error");
      return;
    }
    setTranscript(session);
    void generate(session, false);
  }, [generate]);

  if (status === "loading") {
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
          <p className="text-[14px] text-muted" aria-live="polite">
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
