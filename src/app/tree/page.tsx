"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CoachAvatar } from "@/components/CoachAvatar";
import { loadBigStory, loadCards } from "@/lib/storage";
import { MAX_SMALL_STORIES, type BigStory, type GoalCard } from "@/types/goal";

/**
 * 目標ツリー。
 * 大きな物語（幹）と、そこにぶら下がる目標（枝）を階層で見せる。
 * 枝のラベルに rationale（なぜ大きな物語に効くのか）を出すことで、
 * 「なぜこれをやっているのか」を一覧で辿れるようにする。
 */
export default function TreePage() {
  const [big, setBig] = useState<BigStory | null>(null);
  const [cards, setCards] = useState<GoalCard[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setBig(loadBigStory());
    setCards(loadCards());
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <>
        <AppHeader title="目標ツリー" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  const active = cards.filter((c) => (c.status ?? "active") !== "done");
  const done = cards.filter((c) => (c.status ?? "active") === "done");
  const linked = active.filter((c) => c.bigStoryId && c.bigStoryId === big?.id);
  const orphans = active.filter((c) => !c.bigStoryId || c.bigStoryId !== big?.id);
  const freeSlots = Math.max(0, MAX_SMALL_STORIES - active.length);

  return (
    <>
      <AppHeader title="目標ツリー" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        {!big && cards.length === 0 ? (
          <p className="mt-10 text-center text-[14px] text-muted">
            まだ何もありません。
            <br />
            <Link href="/" className="underline">
              ホームからはじめてください
            </Link>
          </p>
        ) : (
          <>
            {/* 幹 */}
            {big ? (
              <Link
                href="/story"
                className="block rounded-xl border-2 border-accent-line bg-accent-soft px-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <div className="flex items-start gap-3">
                  <CoachAvatar id={big.coachId} size={34} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                      大きな物語 ・{big.horizonYears}年
                    </p>
                    <p className="mt-1.5 font-serif text-[15px] leading-[1.6] font-bold">
                      {big.vision.refined || big.vision.raw || "（未記入）"}
                    </p>
                  </div>
                </div>
                {big.values.length > 0 && (
                  <ul className="mt-2.5 flex flex-wrap gap-1.5">
                    {big.values.map((v) => (
                      <li
                        key={v}
                        className="rounded-full border border-accent-line bg-paper px-2.5 py-0.5 text-[11.5px] text-accent"
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
                className="block rounded-xl border-2 border-dashed border-line px-4 py-5 text-center text-[13.5px] text-muted"
              >
                ＋ 幹になる大きな物語をつくる
              </Link>
            )}

            {/* 枝 */}
            <div className="relative mt-1 pl-5">
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 h-full w-px bg-line"
              />

              {linked.map((c) => (
                <Branch key={c.id} card={c} />
              ))}

              {linked.length === 0 && big && (
                <p className="py-4 pl-3 text-[12.5px] leading-relaxed text-muted">
                  この物語にぶら下がる目標はまだありません。
                </p>
              )}

              {freeSlots > 0 && (
                <div className="relative py-2">
                  <span
                    aria-hidden="true"
                    className="absolute -left-5 top-1/2 h-px w-5 bg-line"
                  />
                  <Link
                    href="/goal/new"
                    className="block rounded-xl border border-dashed border-line px-4 py-3 text-center text-[13px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    ＋ 空き枠 {freeSlots} / {MAX_SMALL_STORIES}
                  </Link>
                </div>
              )}
            </div>

            {orphans.length > 0 && (
              <section className="mt-8">
                <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                  物語に紐づいていない目標
                </h2>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  詳細画面から大きな物語に紐づけられます。
                </p>
                <div className="mt-2 flex flex-col gap-2">
                  {orphans.map((c) => (
                    <Branch key={c.id} card={c} bare />
                  ))}
                </div>
              </section>
            )}

            {done.length > 0 && (
              <section className="mt-8">
                <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                  完了
                </h2>
                <div className="mt-2 flex flex-col gap-2">
                  {done.map((c) => (
                    <Branch key={c.id} card={c} bare muted />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </>
  );
}

function Branch({
  card,
  bare,
  muted,
}: {
  card: GoalCard;
  bare?: boolean;
  muted?: boolean;
}) {
  const title = card.vision.refined || card.vision.raw || "（未記入の目標）";
  const task = card.tasks[0];

  return (
    <div className={`relative ${bare ? "" : "py-2"}`}>
      {!bare && (
        <span
          aria-hidden="true"
          className="absolute -left-5 top-1/2 h-px w-5 bg-line"
        />
      )}
      <Link
        href={`/goal/${card.id}`}
        className={`block rounded-xl border border-line bg-surface px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          muted ? "opacity-60" : ""
        }`}
      >
        <p className="text-[14px] leading-relaxed font-medium">{title}</p>

        {card.rationale ? (
          <p className="mt-2 border-l-2 border-accent-line pl-2.5 text-[12.5px] leading-relaxed text-muted">
            なぜ効くか: {card.rationale}
          </p>
        ) : (
          <p className="mt-2 border-l-2 border-line pl-2.5 text-[12px] leading-relaxed text-muted">
            大きな物語とのつながりが未記入
          </p>
        )}

        <dl className="mt-2.5 flex flex-col gap-1 font-mono text-[11px] text-muted">
          {card.smart.measurable && (
            <div className="flex gap-1.5">
              <dt className="shrink-0">どれくらい</dt>
              <dd className="min-w-0 flex-1 truncate">{card.smart.measurable}</dd>
            </div>
          )}
          <div className="flex gap-1.5">
            <dt className="shrink-0">いつまでに</dt>
            <dd>{card.smart.deadline || "未設定"}</dd>
          </div>
          {task && (
            <div className="flex gap-1.5">
              <dt className="shrink-0">次の一歩</dt>
              <dd className="min-w-0 flex-1 truncate">
                {task.title}（{task.estimateMin}分）
              </dd>
            </div>
          )}
        </dl>
      </Link>
    </div>
  );
}
