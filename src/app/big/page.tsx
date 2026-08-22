"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditableField } from "@/components/EditableField";
import {
  archiveSession,
  clearSession,
  loadBigStory,
  loadSession,
  saveBigStory,
  saveProfile,
} from "@/lib/storage";
import type { BigStory, Session } from "@/types/goal";

type Status = "loading" | "ready" | "error";

export default function BigStoryPage() {
  const router = useRouter();
  const [story, setStory] = useState<BigStory | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const ran = useRef(false);

  const generate = useCallback(async (session: Session, isRetry: boolean) => {
    setStatus("loading");
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
        milestones: data.bigStory.milestones,
        editedFields: [],
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
      setStory(built);
      setStatus("ready");
    } catch (err) {
      if (!isRetry) return generate(session, true);
      setError(err instanceof Error ? err.message : "整理に失敗しました。");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const existing = loadBigStory();
    if (existing) {
      setStory(existing);
      setStatus("ready");
      return;
    }
    const session = loadSession();
    if (!session || session.mode !== "big" || session.messages.length === 0) {
      setError("Big Storyの対話が見つかりませんでした。");
      setStatus("error");
      return;
    }
    sessionRef.current = session;
    void generate(session, false);
  }, [generate]);

  function update(path: string, mutate: (b: BigStory) => BigStory) {
    setStory((prev) => {
      if (!prev) return prev;
      const next = mutate(prev);
      next.updatedAt = new Date().toISOString();
      next.editedFields = prev.editedFields.includes(path)
        ? prev.editedFields
        : [...prev.editedFields, path];
      saveBigStory(next);
      return next;
    });
  }

  function confirm() {
    if (sessionRef.current) archiveSession(sessionRef.current);
    clearSession();
    router.push("/home");
  }

  if (status === "loading") {
    return (
      <main className="phone flex flex-1 flex-col items-center justify-center gap-3 px-5">
        <div className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 animate-pulse rounded-full bg-accent"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
        <p className="text-[13px] text-muted">整理しています…</p>
      </main>
    );
  }

  if (status === "error" || !story) {
    return (
      <main className="phone flex flex-1 flex-col items-center justify-center gap-3 px-5">
        <p className="text-[13px] text-muted">{error ?? "読み込めませんでした。"}</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-xl bg-indigo px-4 py-2.5 text-[13px] text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          トップへ戻る
        </button>
      </main>
    );
  }

  return (
    <main className="phone flex flex-1 flex-col px-5 py-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        Big Story
      </p>
      <h1 className="mt-3 font-serif text-[22px] leading-[1.5] font-bold">
        あなたの大きな物語
      </h1>

      <section className="mt-6 flex flex-col gap-5">
        <div>
          <p className="text-[13px] font-bold">理想像</p>
          <div className="mt-1.5">
            <EditableField
              value={story.vision.refined}
              label="理想像"
              multiline
              onSave={(next) =>
                update("vision.refined", (b) => ({
                  ...b,
                  vision: { ...b.vision, refined: next },
                }))
              }
            />
          </div>
        </div>

        <div>
          <p className="text-[13px] font-bold">大事にしているもの</p>
          <div className="mt-1.5">
            <EditableField
              value={story.values.join(" / ")}
              label="大事にしているもの"
              onSave={(next) =>
                update("values", (b) => ({
                  ...b,
                  values: next.split("/").map((v) => v.trim()).filter(Boolean),
                }))
              }
            />
          </div>
        </div>

        <div>
          <p className="text-[13px] font-bold">今の立ち位置</p>
          <div className="mt-1.5">
            <EditableField
              value={story.currentPosition}
              label="今の立ち位置"
              multiline
              onSave={(next) =>
                update("currentPosition", (b) => ({ ...b, currentPosition: next }))
              }
            />
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={confirm}
        className="mt-10 rounded-xl bg-indigo px-4 py-3.5 text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        これで進める
      </button>
    </main>
  );
}

function avgUserLength(session: Session): number {
  const userMsgs = session.messages.filter((m) => m.role === "user");
  if (userMsgs.length === 0) return 0;
  return Math.round(
    userMsgs.reduce((sum, m) => sum + m.content.length, 0) / userMsgs.length,
  );
}
