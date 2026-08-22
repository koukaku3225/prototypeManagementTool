"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CoachAvatar } from "@/components/CoachAvatar";
import { COACHES } from "@/lib/prompts/coaches";
import {
  activeCards,
  loadBigStory,
  loadCards,
  loadSession,
  upsertCard,
} from "@/lib/storage";
import { MAX_SMALL_STORIES, type BigStory, type GoalCard } from "@/types/goal";

/**
 * ホーム（ハブ）。
 * 以前はここがコーチ選択のランディングで、目標を作ったあと戻る場所が
 * どこにも無かった。大きな物語・今日やること・目標3枠を一枚にまとめ、
 * すべての画面からここへ戻れるようにする。
 */
export default function HomePage() {
  const [big, setBig] = useState<BigStory | null>(null);
  const [cards, setCards] = useState<GoalCard[]>([]);
  const [resumable, setResumable] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    reload();
    const s = loadSession();
    setResumable(Boolean(s && !s.completedAt && s.messages.length > 0));
    setReady(true);
  }, []);

  function reload() {
    setBig(loadBigStory());
    setCards(loadCards());
  }

  function toggleTask(cardId: string, taskId: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    upsertCard({
      ...card,
      updatedAt: new Date().toISOString(),
      tasks: card.tasks.map((t) =>
        t.id === taskId
          ? { ...t, completedAt: t.completedAt ? null : new Date().toISOString() }
          : t,
      ),
    });
    reload();
  }

  if (!ready) {
    return (
      <>
        <AppHeader />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  const active = cards.filter((c) => (c.status ?? "active") !== "done");
  const done = cards.filter((c) => (c.status ?? "active") === "done");
  const freeSlots = Math.max(0, MAX_SMALL_STORIES - active.length);
  const todays = active.flatMap((c) => c.tasks.map((t) => ({ card: c, task: t })));
  const empty = !big && cards.length === 0;

  return (
    <>
      <AppHeader />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        {resumable && (
          <Link
            href="/session"
            className="mb-4 rounded-xl border border-accent-line bg-accent-soft px-4 py-3 text-[14px] font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            中断した対話を再開する →
          </Link>
        )}

        {empty ? (
          <section className="mt-4 flex flex-col gap-4">
            <h1 className="font-serif text-[26px] leading-[1.4] font-bold text-balance">
              あなたの&ldquo;なりたい姿&rdquo;を、
              <br />
              明日の一歩に変えます
            </h1>
            <p className="text-[14px] leading-relaxed text-muted">
              まず5〜10年の大きな物語を言葉にして、そこから直近の目標を
              最大{MAX_SMALL_STORIES}つまでぶら下げていきます。
            </p>
            <Link
              href="/story/new"
              className="rounded-xl bg-indigo px-4 py-3.5 text-center text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              大きな物語をつくる
            </Link>
            <Link
              href="/goal/new"
              className="rounded-xl border border-line bg-surface px-4 py-3 text-center text-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              先に直近の目標だけつくる
            </Link>
          </section>
        ) : (
          <>
            <section>
              <SectionLabel
                label="大きな物語"
                action={big ? { href: "/story", text: "編集" } : undefined}
              />
              {big ? (
                <Link
                  href="/story"
                  className="mt-2 block rounded-xl border border-line bg-surface px-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <div className="flex items-start gap-3">
                    <CoachAvatar id={big.coachId} size={36} className="shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-serif text-[15px] leading-[1.6] font-bold">
                        {big.vision.refined || big.vision.raw || "（未記入）"}
                      </p>
                      <p className="mt-1 font-mono text-[10.5px] text-muted">
                        {big.horizonYears}年
                      </p>
                    </div>
                  </div>
                  {big.values.length > 0 && (
                    <ul className="mt-2.5 flex flex-wrap gap-1.5">
                      {big.values.map((v) => (
                        <li
                          key={v}
                          className="rounded-full border border-accent-line bg-accent-soft px-2.5 py-0.5 text-[11.5px] text-accent"
                        >
                          {v}
                        </li>
                      ))}
                    </ul>
                  )}
                </Link>
              ) : (
                <Link
                  href="/story/new"
                  className="mt-2 block rounded-xl border border-dashed border-line px-4 py-4 text-center text-[13.5px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  ＋ 大きな物語をつくる
                </Link>
              )}
            </section>

            {todays.length > 0 && (
              <section className="mt-6">
                <SectionLabel label="今日やること" />
                <ul className="mt-2 flex flex-col gap-2">
                  {todays.map(({ card, task }) => (
                    <li
                      key={task.id}
                      className="rounded-xl border border-accent-line bg-accent-soft px-4 py-3"
                    >
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          checked={Boolean(task.completedAt)}
                          onChange={() => toggleTask(card.id, task.id)}
                          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block text-[14.5px] leading-relaxed ${
                              task.completedAt ? "text-muted line-through" : ""
                            }`}
                          >
                            {task.title}
                          </span>
                          <span className="mt-1 block font-mono text-[11px] text-muted">
                            {task.estimateMin}分 / {task.dueDate}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-6">
              <SectionLabel label={`目標  ${active.length}/${MAX_SMALL_STORIES}`} />
              <div className="mt-2 flex flex-col gap-2">
                {active.map((c) => (
                  <GoalRow key={c.id} card={c} />
                ))}

                {freeSlots > 0 && (
                  <Link
                    href="/goal/new"
                    className="rounded-xl border border-dashed border-line px-4 py-3.5 text-center text-[13.5px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    ＋ 目標を追加する（残り{freeSlots}枠）
                  </Link>
                )}

                {freeSlots === 0 && (
                  <p className="px-1 text-[12px] leading-relaxed text-muted">
                    枠が{MAX_SMALL_STORIES}つとも埋まっています。
                    どれかを「完了」にすると空きます。
                  </p>
                )}
              </div>
            </section>

            {done.length > 0 && (
              <section className="mt-6">
                <SectionLabel label={`完了した目標  ${done.length}`} />
                <div className="mt-2 flex flex-col gap-2">
                  {done.map((c) => (
                    <GoalRow key={c.id} card={c} muted />
                  ))}
                </div>
              </section>
            )}

            <Link
              href="/tree"
              className="mt-6 rounded-xl border border-line bg-surface px-4 py-3 text-center text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              目標ツリーで関係を見る →
            </Link>
          </>
        )}
      </main>
    </>
  );
}

function SectionLabel({
  label,
  action,
}: {
  label: string;
  action?: { href: string; text: string };
}) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
        {label}
      </h2>
      {action && (
        <Link
          href={action.href}
          className="ml-auto text-[12px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {action.text}
        </Link>
      )}
    </div>
  );
}

function GoalRow({ card, muted }: { card: GoalCard; muted?: boolean }) {
  const coach = COACHES[card.coachId];
  const title = card.vision.refined || card.vision.raw || "（未記入の目標）";

  return (
    <Link
      href={`/goal/${card.id}`}
      className={`rounded-xl border border-line bg-surface px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        muted ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <CoachAvatar id={card.coachId} size={30} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-relaxed font-medium">{title}</p>
          <p className="mt-1 font-mono text-[11px] text-muted">
            {card.smart.deadline || "期限未設定"}
            {card.source === "manual" ? " ・手入力" : ` ・${coach?.name ?? ""}`}
          </p>
          {card.rationale && (
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              つながり: {card.rationale}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
