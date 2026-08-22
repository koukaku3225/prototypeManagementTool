"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { COACHES } from "@/lib/prompts/coaches";
import { download, toMarkdown } from "@/lib/export";
import {
  clearSession,
  loadBigStory,
  loadCard,
  newSession,
  resetAll,
  saveCard,
  saveSession,
} from "@/lib/storage";
import type { BigStory, GoalCard } from "@/types/goal";

export default function HomePage() {
  const router = useRouter();
  const [card, setCard] = useState<GoalCard | null>(null);
  const [big, setBig] = useState<BigStory | null>(null);
  const [ready, setReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setCard(loadCard());
    setBig(loadBigStory());
    setReady(true);
  }, []);

  /** 大きな物語を踏まえて、直近の1つを掘る対話に入る */
  function startSmall() {
    clearSession();
    saveSession(newSession(big?.coachId ?? "kaede", "small"));
    router.push("/session");
  }

  if (!ready) return <main className="phone flex-1 px-5 py-10" aria-busy="true" />;

  if (!card) {
    return (
      <main className="phone flex flex-1 flex-col px-5 py-8">
        {big && <BigStorySection big={big} />}
        <p className="mt-8 text-[14px] text-muted">
          {big
            ? "まだ直近の目標がありません。大きな物語から1つ選んで掘り下げましょう。"
            : "まだ目標がありません。"}
        </p>
        <button
          type="button"
          onClick={() => (big ? startSmall() : router.push("/"))}
          className="mt-4 rounded-xl bg-indigo px-5 py-3 text-[14px] text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {big ? "直近の目標を決める" : "対話をはじめる"}
        </button>
      </main>
    );
  }

  const coach = COACHES[card.coachId];
  const task = card.tasks[0];

  function toggleTask() {
    setCard((prev) => {
      if (!prev || !prev.tasks[0]) return prev;
      const t = prev.tasks[0];
      const next: GoalCard = {
        ...prev,
        tasks: [
          { ...t, completedAt: t.completedAt ? null : new Date().toISOString() },
          ...prev.tasks.slice(1),
        ],
      };
      saveCard(next);
      return next;
    });
  }

  return (
    <main className="phone flex flex-1 flex-col px-5 py-8">
      {big && <BigStorySection big={big} onAddSmall={startSmall} />}

      <header className="mt-8 flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
          いまの目標
        </p>
        <span className="text-[11.5px] text-muted">{coach.name}</span>
      </header>

      <h1 className="mt-3 font-serif text-[22px] leading-[1.5] font-bold text-balance">
        {card.vision.refined || card.vision.raw}
      </h1>

      <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
        {card.smart.measurable}
        {card.smart.deadline && ` / ${card.smart.deadline} まで`}
      </p>

      {/* 明日やること — 唯一の行動 */}
      <section className="mt-6 rounded-xl border border-accent-line bg-accent-soft px-4 py-4">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-accent">
          明日やること
        </h2>
        {task ? (
          <label className="mt-2.5 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={Boolean(task.completedAt)}
              onChange={toggleTask}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span className="flex-1">
              <span
                className={`block text-[15px] leading-relaxed ${
                  task.completedAt ? "text-muted line-through" : ""
                }`}
              >
                {task.title}
              </span>
              <span className="mt-1 block font-mono text-[11.5px] text-muted">
                {task.estimateMin}分 / {task.dueDate}
              </span>
            </span>
          </label>
        ) : (
          <p className="mt-2 text-[13px] text-muted">タスクが登録されていません。</p>
        )}
      </section>

      {/* コーチからの一言 — テンプレに目標の文言を差し込むだけ。API呼び出しなし */}
      <section className="mt-3 rounded-xl border border-line bg-surface px-4 py-3.5">
        <p className="text-[11.5px] text-muted">{coach.name}より</p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed">
          {coachLine(card, big)}
        </p>
      </section>

      {card.woop.obstacles[0] && (
        <section className="mt-3 rounded-xl border border-line bg-surface px-4 py-3.5">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
            つまずいたら
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed">
            もし<b>{card.woop.obstacles[0].plan.if}</b>
            <br />→ <b>{card.woop.obstacles[0].plan.then}</b>
          </p>
        </section>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-4 self-start text-[13px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {expanded ? "理由を隠す" : "なぜこれが大事なのかを見る"}
      </button>

      {expanded && (
        <section className="mt-3 rounded-xl border border-line bg-surface px-4 py-4">
          {card.meaning.whyChain.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {card.meaning.whyChain.map((why, i) => (
                <li key={i} className="flex gap-2 text-[13.5px] leading-relaxed">
                  <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                  <span>{why}</span>
                </li>
              ))}
            </ul>
          ) : big ? (
            // 「なぜ」は大きな物語の側に置いてあるので、そちらを参照させる
            <div className="flex flex-col gap-2">
              <p className="text-[13.5px] leading-relaxed">
                この目標は、あなたの大きな物語につながっています。
              </p>
              <p className="text-[13.5px] leading-relaxed font-bold">
                {big.vision.refined || big.vision.raw}
              </p>
              {big.values.length > 0 && (
                <p className="text-[13px] leading-relaxed text-muted">
                  大事にしているもの: {big.values.join(" / ")}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[13.5px] leading-relaxed text-muted">
              理由はまだ記録されていません。
            </p>
          )}
          {card.commitment.userWords && (
            <p className="mt-3 border-t border-line-soft pt-3 text-[13.5px] leading-relaxed">
              あなたの約束: 「{card.commitment.userWords}」
            </p>
          )}
        </section>
      )}

      <div className="mt-8 flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() =>
              download(`goal-${card.createdAt.slice(0, 10)}.md`, toMarkdown(card), "text/markdown")
            }
            className="flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Markdown で保存
          </button>
          <button
            type="button"
            onClick={() =>
              download(
                `goal-${card.createdAt.slice(0, 10)}.json`,
                JSON.stringify(card, null, 2),
                "application/json",
              )
            }
            className="flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            JSON で保存
          </button>
        </div>

        {confirming ? (
          <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
            <p className="text-[13px] leading-relaxed">
              いまの目標と対話の記録がすべて消えます。先に保存しておいてください。
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  resetAll();
                  router.push("/");
                }}
                className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] text-surface"
              >
                消して最初から
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-muted"
              >
                やめる
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="self-start px-1 py-1 text-[12.5px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            目標を作り直す
          </button>
        )}
      </div>
    </main>
  );
}

/**
 * 大きな物語をホーム最上部に常に出す。
 * これが無いと Big Story を作った直後から二度と見返せなかった。
 */
function BigStorySection({
  big,
  onAddSmall,
}: {
  big: BigStory;
  onAddSmall?: () => void;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface px-4 py-4">
      <div className="flex items-baseline gap-2">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
          大きな物語
        </p>
        <span className="ml-auto font-mono text-[11px] text-muted">
          {big.horizonYears}年
        </span>
      </div>

      <p className="mt-2 font-serif text-[16px] leading-[1.6] font-bold text-balance">
        {big.vision.refined || big.vision.raw}
      </p>

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

      {big.milestones.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {big.milestones.map((m, i) => (
            <li key={i} className="text-[12.5px] leading-relaxed">
              <span className="font-mono text-muted">{m.label}</span> — {m.state}
            </li>
          ))}
        </ul>
      )}

      {big.currentPosition && (
        <p className="mt-2.5 border-t border-line-soft pt-2.5 text-[12.5px] leading-relaxed text-muted">
          いま: {big.currentPosition}
        </p>
      )}

      {onAddSmall && (
        <button
          type="button"
          onClick={onAddSmall}
          className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ここから直近の目標を追加する
        </button>
      )}
    </section>
  );
}

/** 個人の文脈に合わせた一言。テンプレへの差し込みのみで、API は呼ばない。 */
function coachLine(card: GoalCard, big: BigStory | null): string {
  const task = card.tasks[0];
  // 「なぜ大事か」は Big Story 側で掘るようにしたので、
  // カード側の価値観が痩せているときは大きな物語の言葉を使う。
  const value = big?.values[0] ?? card.meaning.values[0];

  if (task?.completedAt) {
    return value
      ? `今日の分は終わりましたね。「${value}」に一歩近づきました。`
      : "今日の分は終わりましたね。";
  }
  if (card.commitment.userWords) {
    return `「${card.commitment.userWords}」と言っていました。${task ? `${task.estimateMin}分だけです。` : ""}`;
  }
  if (value) {
    return `あなたが大事にしているのは「${value}」でしたね。${task ? `今日は${task.estimateMin}分だけです。` : ""}`;
  }
  return task ? `今日は${task.estimateMin}分だけです。` : "今日も一歩進めましょう。";
}
