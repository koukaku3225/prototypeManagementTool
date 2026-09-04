"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CoachPicker } from "@/components/CoachPicker";
import { TechniqueBrief } from "@/components/TechniqueBrief";
import {
  clearSession,
  loadBigStory,
  newSession,
  saveBigStory,
  saveSession,
} from "@/lib/storage";
import type { BigStory, CoachId } from "@/types/goal";

/** 大きな物語をつくる。1件だけ持てる。 */
export default function NewStoryPage() {
  const router = useRouter();
  const [coach, setCoach] = useState<CoachId>("kaede");
  const [existing, setExisting] = useState<BigStory | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const s = loadBigStory();
    setExisting(s);
    // 既存の大きな物語を作り直すときは、そのコーチを初期選択にする。
    // 既定の "kaede" のまま気づかず対話を始めると、以前と違うコーチに
    // 差し替わってしまう
    if (s) setCoach(s.coachId);
    setReady(true);
  }, []);

  function startDialogue() {
    clearSession();
    saveSession(newSession(coach, "big"));
    router.push("/session");
  }

  function startManual() {
    const now = new Date().toISOString();
    const story: BigStory = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      coachId: coach,
      horizonYears: 10,
      vision: { raw: "", refined: "" },
      values: [],
      currentPosition: "",
      milestones: [],
      editedFields: [],
    };
    saveBigStory(story);
    router.push("/story");
  }

  if (!ready) {
    return (
      <>
        <AppHeader title="大きな物語" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  return (
    <>
      <AppHeader title="大きな物語" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        <h1 className="font-serif text-[20px] leading-[1.5] font-bold">
          5〜10年の大きな物語をつくる
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          ここで決めた理想像と価値観が、直近の目標を選ぶときの土台になります。
        </p>

        {existing && (
          <div className="mt-4 rounded-xl border border-accent-line bg-accent-soft px-3.5 py-3">
            <p className="text-[12.5px] leading-relaxed">
              すでに大きな物語があります。作り直すと今のものは置き換わります。
            </p>
            <Link href="/story" className="mt-1.5 inline-block text-[12.5px] underline">
              今の物語を見る
            </Link>
          </div>
        )}

        <div className="mt-4">
          <TechniqueBrief ids={["self-determination", "grow", "mental-contrasting"]} />
        </div>

        <h2 className="mt-6 text-[13px] font-bold">つくり方を選ぶ</h2>
        <div className="mt-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={startDialogue}
            className="rounded-xl bg-indigo px-4 py-3.5 text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            対話でつくる（3ステップ・約6問）
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
        <div className="mt-2">
          <CoachPicker value={coach} onChange={setCoach} />
        </div>
      </main>
    </>
  );
}
