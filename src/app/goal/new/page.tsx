"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CoachPicker } from "@/components/CoachPicker";
import { TechniqueBrief } from "@/components/TechniqueBrief";
import {
  activeCards,
  clearSession,
  emptyCard,
  loadBigStory,
  newSession,
  saveSession,
  upsertCard,
} from "@/lib/storage";
import { MAX_SMALL_STORIES, type BigStory, type CoachId } from "@/types/goal";

/** 目標を足す。対話でも手入力でも同じ形の目標ができる。 */
export default function NewGoalPage() {
  const router = useRouter();
  const [coach, setCoach] = useState<CoachId>("kaede");
  const [big, setBig] = useState<BigStory | null>(null);
  const [full, setFull] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const b = loadBigStory();
    setBig(b);
    if (b) setCoach(b.coachId);
    setFull(activeCards().length >= MAX_SMALL_STORIES);
    setReady(true);
  }, []);

  function startDialogue() {
    clearSession();
    saveSession(newSession(coach, "small"));
    router.push("/session");
  }

  function startManual() {
    const card = emptyCard(coach, big?.id ?? null);
    upsertCard(card);
    router.push(`/goal/${card.id}`);
  }

  if (!ready) {
    return (
      <>
        <AppHeader title="目標を足す" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  if (full) {
    return (
      <>
        <AppHeader title="目標を足す" />
        <main className="phone flex flex-1 flex-col gap-4 px-5 py-10">
          <h1 className="font-serif text-[20px] font-bold">枠が埋まっています</h1>
          <p className="text-[14px] leading-relaxed text-muted">
            同時に進める目標は{MAX_SMALL_STORIES}つまでです。
            どれかを完了にすると枠が空きます。
          </p>
          <Link
            href="/"
            className="rounded-xl bg-indigo px-4 py-3 text-center text-[14px] text-surface"
          >
            ホームへ戻る
          </Link>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader title="目標を足す" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        <h1 className="font-serif text-[20px] leading-[1.5] font-bold">
          直近の目標をつくる
        </h1>

        {big ? (
          <p className="mt-2 rounded-xl border border-line bg-surface px-3.5 py-3 text-[12.5px] leading-relaxed text-muted">
            大きな物語から細分化します。
            <br />
            <span className="text-[color:var(--fg)]">
              {big.vision.refined || big.vision.raw}
            </span>
          </p>
        ) : (
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            大きな物語がまだありません。単独の目標として作ります。
          </p>
        )}

        <div className="mt-4">
          <TechniqueBrief
            ids={["smart", "mental-contrasting", "implementation-intentions"]}
          />
        </div>

        <h2 className="mt-6 text-[13px] font-bold">つくり方を選ぶ</h2>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={startDialogue}
            className="rounded-xl bg-indigo px-4 py-3.5 text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            対話でつくる（3ステップ・約7問）
          </button>
          <button
            type="button"
            onClick={startManual}
            className="rounded-xl border border-line bg-surface px-4 py-3.5 text-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            手入力でつくる（AIを使わない）
          </button>
        </div>

        <h2 className="mt-7 text-[13px] font-bold">コーチを選ぶ</h2>
        <p className="mt-1 text-[12px] text-muted">
          手入力のときは記録だけに使われます。
        </p>
        <div className="mt-2">
          <CoachPicker value={coach} onChange={setCoach} />
        </div>
      </main>
    </>
  );
}
