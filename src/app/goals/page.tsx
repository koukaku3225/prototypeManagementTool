"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CoachAvatar } from "@/components/CoachAvatar";
import { COACHES } from "@/lib/prompts/coaches";
import { habitsOfCard, loadBigStory, loadCards } from "@/lib/storage";
import { scheduleLabel } from "@/lib/habit";
import { MAX_SMALL_STORIES, type BigStory, type GoalCard } from "@/types/goal";
import type { Habit } from "@/types/behavior";

/**
 * 目標。
 *
 * 以前は「ホーム」と「ツリー」が別の場所に分かれていたが、
 * ツリーは場所ではなくビューだった（同じ loadBigStory / loadCards を読み、
 * 新しい情報はゼロ）。ビューを場所として扱ったことが、導線が二重になった原因。
 * ここでは1つの場所の中の表示切替にしてある。
 *
 * 大きな物語は仕様上つねに1件なので、常設タブを与えず
 * この画面の「幹」として置く。目標が物語にぶら下がる、という
 * このアプリの中心概念がそのまま画面に出る。
 */
type View = "list" | "tree";

export default function GoalsPage() {
  return (
    <Suspense
      fallback={
        <>
          <AppHeader title="目標" />
          <main className="phone flex-1 px-5 py-10" aria-busy="true" />
        </>
      }
    >
      <GoalsInner />
    </Suspense>
  );
}

function GoalsInner() {
  const router = useRouter();
  const params = useSearchParams();
  const view: View = params.get("view") === "tree" ? "tree" : "list";

  const [big, setBig] = useState<BigStory | null>(null);
  const [cards, setCards] = useState<GoalCard[]>([]);
  const [habits, setHabits] = useState<Record<string, Habit[]>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const cs = loadCards();
    setBig(loadBigStory());
    setCards(cs);
    setHabits(Object.fromEntries(cs.map((c) => [c.id, habitsOfCard(c.id)])));
    setReady(true);
  }, []);

  function setView(v: View) {
    // URLに残す。表示の切り替えは戻るで元に戻せたほうがよい
    router.replace(v === "tree" ? "/goals?view=tree" : "/goals");
  }

  if (!ready) {
    return (
      <>
        <AppHeader title="目標" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  const active = cards.filter((c) => (c.status ?? "active") !== "done");
  const done = cards.filter((c) => (c.status ?? "active") === "done");
  const freeSlots = Math.max(0, MAX_SMALL_STORIES - active.length);
  const empty = !big && cards.length === 0;

  return (
    <>
      <AppHeader title="目標" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        {empty ? (
          <section className="mt-4 flex flex-col gap-4">
            <h1 className="font-serif text-[24px] leading-[1.45] font-bold text-balance">
              あなたの&ldquo;理想&rdquo;を、
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
            {/* 幹 */}
            {big ? (
              <Link
                href="/story"
                className={`block rounded-xl bg-accent-soft px-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  view === "tree" ? "border-2 border-accent-line" : "border border-accent-line"
                }`}
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
                className="block rounded-xl border-2 border-dashed border-line px-4 py-5 text-center text-[13.5px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                ＋ 幹になる大きな物語をつくる
              </Link>
            )}

            {/* 表示の切り替え。場所の移動ではないので、タブではなくここに置く */}
            <div
              role="group"
              aria-label="目標の表示"
              className="mt-4 flex gap-1 rounded-lg border border-line bg-surface p-1"
            >
              <ViewButton on={view === "list"} onClick={() => setView("list")}>
                リスト
              </ViewButton>
              <ViewButton on={view === "tree"} onClick={() => setView("tree")}>
                ツリー
              </ViewButton>
            </div>

            <div className="mt-3">
              {view === "tree" ? (
                <TreeView cards={active} big={big} habits={habits} />
              ) : (
                <div className="flex flex-col gap-2">
                  {active.map((c) => (
                    <GoalRow key={c.id} card={c} habits={habits[c.id] ?? []} />
                  ))}
                </div>
              )}

              {freeSlots > 0 ? (
                <Link
                  href="/goal/new"
                  className="mt-2 block rounded-xl border border-dashed border-line px-4 py-3.5 text-center text-[13.5px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  ＋ 目標を追加する（残り{freeSlots}枠）
                </Link>
              ) : (
                <p className="mt-2 px-1 text-[12px] leading-relaxed text-muted">
                  枠が{MAX_SMALL_STORIES}つとも埋まっています。
                  どれかを「完了」にすると空きます。
                </p>
              )}
            </div>

            {done.length > 0 && (
              <section className="mt-7">
                <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
                  完了した目標  {done.length}
                </h2>
                <div className="mt-2 flex flex-col gap-2">
                  {done.map((c) => (
                    <GoalRow key={c.id} card={c} habits={[]} muted />
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

function ViewButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex-1 rounded-md px-3 py-1.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        on ? "bg-accent-soft font-medium text-accent" : "text-muted"
      }`}
    >
      {children}
    </button>
  );
}

/** ツリー表示。幹は上に出ているので、ここは枝だけ描く */
function TreeView({
  cards,
  big,
  habits,
}: {
  cards: GoalCard[];
  big: BigStory | null;
  habits: Record<string, Habit[]>;
}) {
  const linked = cards.filter((c) => c.bigStoryId && c.bigStoryId === big?.id);
  const orphans = cards.filter((c) => !c.bigStoryId || c.bigStoryId !== big?.id);

  return (
    <>
      <div className="relative pl-5">
        <span aria-hidden="true" className="absolute left-0 top-0 h-full w-px bg-line" />
        {linked.map((c) => (
          <div key={c.id} className="relative py-1.5">
            <span aria-hidden="true" className="absolute -left-5 top-1/2 h-px w-5 bg-line" />
            <GoalRow card={c} habits={habits[c.id] ?? []} showRationale />
          </div>
        ))}
        {linked.length === 0 && big && (
          <p className="py-3 pl-3 text-[12.5px] leading-relaxed text-muted">
            この物語にぶら下がる目標はまだありません。
          </p>
        )}
      </div>

      {orphans.length > 0 && (
        <section className="mt-5">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
            物語に紐づいていない目標
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            詳細画面から大きな物語に紐づけられます。
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {orphans.map((c) => (
              <GoalRow key={c.id} card={c} habits={habits[c.id] ?? []} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function GoalRow({
  card,
  habits,
  muted,
  showRationale,
}: {
  card: GoalCard;
  habits: Habit[];
  muted?: boolean;
  showRationale?: boolean;
}) {
  const coach = COACHES[card.coachId];
  const title = card.vision.refined || card.vision.raw || "（未記入の目標）";
  const task = card.tasks[0];

  return (
    <Link
      href={`/goal/${card.id}`}
      className={`block rounded-xl border border-line bg-surface px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
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
        </div>
      </div>

      {showRationale &&
        (card.rationale ? (
          <p className="mt-2 border-l-2 border-accent-line pl-2.5 text-[12.5px] leading-relaxed text-muted">
            なぜ効くか: {card.rationale}
          </p>
        ) : (
          <p className="mt-2 border-l-2 border-line pl-2.5 text-[12px] leading-relaxed text-muted">
            大きな物語とのつながりが未記入
          </p>
        ))}

      {(habits.length > 0 || task) && (
        <dl className="mt-2.5 flex flex-col gap-1 font-mono text-[11px] text-muted">
          {task && (
            <div className="flex gap-1.5">
              <dt className="shrink-0">次の一歩</dt>
              <dd className="min-w-0 flex-1 truncate">
                {[task.startTime, task.where].filter(Boolean).join(" ")}
                {task.startTime || task.where ? " ・ " : ""}
                {task.title}（{task.estimateMin}分）
              </dd>
            </div>
          )}
          {habits.length > 0 && (
            <div className="flex gap-1.5">
              <dt className="shrink-0">習慣</dt>
              <dd className="min-w-0 flex-1 truncate">
                {habits
                  .map((h) => `${h.title}（${scheduleLabel(h)}）`)
                  .join(" / ")}
              </dd>
            </div>
          )}
        </dl>
      )}
    </Link>
  );
}
