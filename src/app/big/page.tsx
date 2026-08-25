"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { OptionPicker } from "@/components/OptionPicker";
import {
  archiveSession,
  clearSession,
  loadSession,
  saveBigStory,
  saveProfile,
} from "@/lib/storage";
import type { BigStory, Session } from "@/types/goal";

interface Draft {
  horizonYears: number;
  visionRaw: string;
  visionOptions: string[];
  valuesOptions: string[];
  currentPositionOptions: string[];
  milestones: { label: string; state: string }[];
  profile: {
    lifePatterns: string[];
    pastFailures: string[];
    valuesAccumulated: string[];
  };
}

/**
 * big モードの対話を大きな物語に整える画面。
 *
 * AIが1案に絞ると、丸められた言い方が本人の言葉を置き換えてしまう。
 * 観点の違う3案を出して、どれにするかは本人に決めてもらう。
 */
export default function BigStoryGenPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Session | null>(null);
  const ran = useRef(false);

  // 選択中の値
  const [vision, setVision] = useState("");
  const [values, setValues] = useState("");
  const [position, setPosition] = useState("");

  const generate = useCallback(async (session: Session, isRetry: boolean) => {
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

      const b = data.bigStory;
      const d: Draft = {
        horizonYears: b.horizonYears,
        visionRaw: b.visionRaw ?? "",
        visionOptions: b.visionOptions ?? [],
        valuesOptions: b.valuesOptions ?? [],
        currentPositionOptions: b.currentPositionOptions ?? [],
        milestones: b.milestones ?? [],
        profile: data.profile,
      };
      setDraft(d);
      // 最初は案1を選んだ状態にしておく
      setVision(d.visionOptions[0] ?? "");
      setValues(d.valuesOptions[0] ?? "");
      setPosition(d.currentPositionOptions[0] ?? "");
    } catch (err) {
      if (!isRetry) return generate(session, true);
      setError(err instanceof Error ? err.message : "整理に失敗しました。");
    }
  }, []);

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

  function confirm() {
    if (!draft || !transcript) return;
    const now = new Date().toISOString();

    saveBigStory({
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      coachId: transcript.coachId,
      horizonYears: draft.horizonYears,
      vision: { raw: draft.visionRaw, refined: vision },
      values: values.split("/").map((s) => s.trim()).filter(Boolean),
      currentPosition: position,
      milestones: draft.milestones,
      editedFields: [],
      sessionId: transcript.id,
    } satisfies BigStory);

    saveProfile({
      updatedAt: now,
      lifePatterns: draft.profile.lifePatterns,
      pastFailures: draft.profile.pastFailures,
      valuesAccumulated: draft.profile.valuesAccumulated,
      communicationStyle: {
        avgResponseLength: avgUserLength(transcript),
        prefersConcrete: avgUserLength(transcript) < 40,
      },
    });

    archiveSession(transcript);
    clearSession();
    router.replace("/story");
  }

  if (error) {
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

  if (!draft) {
    return (
      <>
        <AppHeader locked lockedNote="整理中は移動できません" />
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

  const ready = vision.trim() && values.trim() && position.trim();

  return (
    <>
      <AppHeader />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        <h1 className="font-serif text-[20px] leading-[1.5] font-bold">
          どの言い方がしっくりきますか
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          対話をもとに、観点を変えた3案を用意しました。選んだものが記録されます。
          どれも違うと感じたら、自分の言葉で書いてください。あとから直せます。
        </p>

        <div className="mt-5 flex flex-col gap-3">
          <OptionPicker
            label="理想像"
            options={draft.visionOptions}
            value={vision}
            onChange={setVision}
            multiline
          />
          <OptionPicker
            label="大事にしているもの"
            hint="スラッシュ区切り"
            options={draft.valuesOptions}
            value={values}
            onChange={setValues}
          />
          <OptionPicker
            label="今の立ち位置"
            options={draft.currentPositionOptions}
            value={position}
            onChange={setPosition}
            multiline
          />
        </div>

        {draft.visionRaw && (
          <details className="mt-3 rounded-xl border border-line bg-surface px-4 py-3">
            <summary className="cursor-pointer text-[12.5px] text-muted">
              自分が最初に言った言葉を見る
            </summary>
            <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap">
              {draft.visionRaw}
            </p>
          </details>
        )}

        <button
          type="button"
          onClick={confirm}
          disabled={!ready}
          className="mt-7 rounded-xl bg-indigo px-4 py-3.5 text-[15px] font-medium text-surface transition-opacity disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          これで確定する
        </button>
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
