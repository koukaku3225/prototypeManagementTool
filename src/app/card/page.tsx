"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { OptionPicker } from "@/components/OptionPicker";
import {
  archiveSession,
  clearSession,
  loadBigStory,
  loadSession,
  saveProfile,
  upsertCard,
} from "@/lib/storage";
import type { GoalCard, Session } from "@/types/goal";

/** APIが返した素の下書き。ここから本人が選ぶ */
interface Draft {
  visionRaw: string;
  visionOptions: string[];
  specificOptions: string[];
  measurableOptions: string[];
  rationaleOptions: string[];
  card: {
    meaning: GoalCard["meaning"];
    smart: Omit<GoalCard["smart"], "specific" | "measurable">;
    woop: { wish: string; outcome: string; obstacles: RawObstacle[] };
    tasks: { title: string; estimateMin: number }[];
    commitment: { userWords: string | null };
  };
  profile: {
    lifePatterns: string[];
    pastFailures: string[];
    valuesAccumulated: string[];
  };
}

interface RawObstacle {
  text: string;
  situation: string;
  plan: { if: string; then: string };
}

/**
 * 対話の結果を目標カードに整える画面。
 * 言い方は1案に絞らず3案出して、どれにするかは本人が決める。
 */
export default function CardPage() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Session | null>(null);
  const ran = useRef(false);

  const [vision, setVision] = useState("");
  const [specific, setSpecific] = useState("");
  const [measurable, setMeasurable] = useState("");
  const [rationale, setRationale] = useState("");

  const generate = useCallback(async (session: Session, isRetry: boolean) => {
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

      const c = data.card;
      const d: Draft = {
        visionRaw: c.visionRaw ?? "",
        visionOptions: c.visionOptions ?? [],
        specificOptions: c.smart?.specificOptions ?? [],
        measurableOptions: c.smart?.measurableOptions ?? [],
        rationaleOptions: c.rationaleOptions ?? [],
        card: {
          meaning: c.meaning,
          smart: {
            metricUnit: c.smart?.metricUnit ?? null,
            metricTarget: c.smart?.metricTarget ?? null,
            deadline: c.smart?.deadline ?? "",
            achievableNote: c.smart?.achievableNote ?? "",
          },
          woop: c.woop,
          tasks: c.tasks ?? [],
          commitment: c.commitment ?? { userWords: null },
        },
        profile: data.profile,
      };
      setDraft(d);
      setVision(d.visionOptions[0] ?? "");
      setSpecific(d.specificOptions[0] ?? "");
      setMeasurable(d.measurableOptions[0] ?? "");
      setRationale(d.rationaleOptions[0] ?? "");
    } catch (err) {
      if (!isRetry) return generate(session, true);
      setError(err instanceof Error ? err.message : "整理に失敗しました。");
    }
  }, []);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const session = loadSession();
    if (!session || session.messages.length === 0) {
      setError("対話が見つかりませんでした。");
      return;
    }
    setTranscript(session);
    void generate(session, false);
  }, [generate]);

  function confirm() {
    if (!draft || !transcript) return;
    const now = new Date().toISOString();
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const big = loadBigStory();

    const built: GoalCard = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      coachId: transcript.coachId,
      bigStoryId: big?.id ?? null,
      rationale,
      status: "active",
      source: "dialogue",
      sessionId: transcript.id,
      vision: { raw: draft.visionRaw, refined: vision },
      meaning: draft.card.meaning,
      smart: { ...draft.card.smart, specific, measurable },
      woop: {
        ...draft.card.woop,
        obstacles: (draft.card.woop.obstacles ?? []).map((o) => ({
          ...o,
          id: crypto.randomUUID(),
        })),
      },
      tasks: draft.card.tasks.slice(0, 1).map((t) => ({
        id: crypto.randomUUID(),
        title: t.title,
        estimateMin: t.estimateMin,
        dueDate: tomorrow,
        completedAt: null,
      })),
      commitment: {
        accepted: Boolean(draft.card.commitment.userWords),
        acceptedAt: draft.card.commitment.userWords ? now : null,
        userWords: draft.card.commitment.userWords,
      },
      editedFields: [],
    };

    upsertCard(built);
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
    router.replace(`/goal/${built.id}`);
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
          <p className="text-[14px] text-muted" aria-live="polite">
            あなたの言葉を整理しています…
          </p>
        </main>
      </>
    );
  }

  const ready = vision.trim() && specific.trim();

  return (
    <>
      <AppHeader />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        <h1 className="font-serif text-[20px] leading-[1.5] font-bold">
          どの言い方がしっくりきますか
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          対話をもとに、観点を変えた3案を用意しました。
          どれも違うと感じたら、自分の言葉で書いてください。あとから直せます。
        </p>

        <div className="mt-5 flex flex-col gap-3">
          <OptionPicker
            label="なりたい姿"
            options={draft.visionOptions}
            value={vision}
            onChange={setVision}
            multiline
          />
          <OptionPicker
            label="何を"
            options={draft.specificOptions}
            value={specific}
            onChange={setSpecific}
            multiline
          />
          <OptionPicker
            label="どれくらい"
            options={draft.measurableOptions}
            value={measurable}
            onChange={setMeasurable}
          />
          {draft.rationaleOptions.length > 0 && (
            <OptionPicker
              label="大きな物語との関係"
              hint="なぜこれが大きな物語に効くのか"
              options={draft.rationaleOptions}
              value={rationale}
              onChange={setRationale}
              multiline
            />
          )}
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

        <p className="mt-4 text-[12px] leading-relaxed text-muted">
          期限・つまずきそうなこと・次の一歩は、次の画面でそのまま編集できます。
        </p>

        <button
          type="button"
          onClick={confirm}
          disabled={!ready}
          className="mt-4 rounded-xl bg-indigo px-4 py-3.5 text-[15px] font-medium text-surface transition-opacity disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
