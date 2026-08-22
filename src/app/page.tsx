"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { COACH_LIST } from "@/lib/prompts/coaches";
import { clearSession, loadCard, loadSession, newSession, saveSession } from "@/lib/storage";
import type { CoachId, StoryMode } from "@/types/goal";

export default function Landing() {
  const router = useRouter();
  const [picked, setPicked] = useState<CoachId>("kaede");
  const [mode, setMode] = useState<StoryMode>("small");
  const [resumable, setResumable] = useState(false);
  const [hasCard, setHasCard] = useState(false);

  useEffect(() => {
    const s = loadSession();
    setResumable(Boolean(s && !s.completedAt && s.messages.length > 0));
    setHasCard(Boolean(loadCard()));
  }, []);

  function start() {
    clearSession();
    saveSession(newSession(picked, mode));
    router.push("/session");
  }

  return (
    <main className="phone flex flex-1 flex-col px-5 py-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        目標設定コーチ
      </p>

      <h1 className="mt-4 font-serif text-[30px] leading-[1.35] font-bold text-balance">
        あなたの&ldquo;なりたい姿&rdquo;を、
        <br />
        明日の一歩に変えます
      </h1>

      <p className="mt-4 text-[14px] leading-relaxed text-muted">
        AIコーチとの対話で、漠然とした願いが、意味づけされた目標と明日やる1つのことになります。
      </p>

      <p className="mt-3 text-[13px] text-muted">
        所要時間 約30〜40分。途中で中断できます。
      </p>

      {(resumable || hasCard) && (
        <div className="mt-6 flex flex-col gap-2">
          {resumable && (
            <button
              type="button"
              onClick={() => router.push("/session")}
              className="rounded-xl border border-accent-line bg-accent-soft px-4 py-3 text-left text-[14px] font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              続きから再開する
            </button>
          )}
          {hasCard && (
            <button
              type="button"
              onClick={() => router.push("/home")}
              className="rounded-xl border border-line bg-surface px-4 py-3 text-left text-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              いまの目標を見る
            </button>
          )}
        </div>
      )}

      <h2 className="mt-10 text-[13px] font-bold">はじめ方を選ぶ</h2>
      <p className="mt-1 text-[12px] text-muted">
        small：直近の目標を5フェーズで深掘りします。big：5〜10年の大きな物語を言葉にします（3〜4問）。
      </p>
      <div className="mt-3 flex gap-2.5">
        <button
          type="button"
          onClick={() => setMode("small")}
          aria-pressed={mode === "small"}
          className={`flex-1 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            mode === "small"
              ? "border-accent-line bg-accent-soft"
              : "border-line bg-surface"
          }`}
        >
          <span className="text-[14px] font-bold">small目標モード</span>
          <p className="mt-1 text-[11.5px] text-muted">直近の1つを深掘りする</p>
        </button>
        <button
          type="button"
          onClick={() => setMode("big")}
          aria-pressed={mode === "big"}
          className={`flex-1 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            mode === "big"
              ? "border-accent-line bg-accent-soft"
              : "border-line bg-surface"
          }`}
        >
          <span className="text-[14px] font-bold">big目標モード</span>
          <p className="mt-1 text-[11.5px] text-muted">5〜10年の物語を言葉にする</p>
        </button>
      </div>

      <h2 className="mt-10 text-[13px] font-bold">コーチを選ぶ</h2>
      <p className="mt-1 text-[12px] text-muted">あとから変えられます。</p>

      <div className="mt-3 flex flex-col gap-2.5">
        {COACH_LIST.map((c) => {
          const on = picked === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setPicked(c.id)}
              aria-pressed={on}
              className={`rounded-xl border px-4 py-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                on
                  ? "border-accent-line bg-accent-soft"
                  : "border-line bg-surface"
              }`}
            >
              <div className="flex items-baseline gap-2.5">
                <span className="text-[15px] font-bold">{c.name}</span>
                <span className="text-[11px] text-muted">{c.tagline}</span>
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                「{c.sample}」
              </p>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={start}
        className="mt-8 rounded-xl bg-indigo px-4 py-3.5 text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        対話をはじめる
      </button>
    </main>
  );
}
