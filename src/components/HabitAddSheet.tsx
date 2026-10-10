"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { HabitEditor } from "@/components/HabitEditor";
import { goalCardLabel } from "@/lib/goal-card";
import { habitsOfCard } from "@/lib/storage";
import type { GoalCard } from "@/types/goal";
import type { Habit } from "@/types/behavior";

/**
 * 習慣タブから、習慣を新しく足すシート。
 *
 * 習慣は必ず長期目標にぶら下げる（孤児の習慣は作らない）ので、
 * 先に「どの目標のための習慣か」を選んでもらう。目標が1つなら選ばせない。
 * 入力の部品は目標の詳細画面と同じ HabitEditor を使う。
 * 作る場所が2つあっても、項目や下書きの扱いが食い違わないようにするため。
 *
 * 開いただけでは何も保存しない（HabitEditor の下書きの約束）。
 */
export function HabitAddSheet({
  cards,
  onClose,
}: {
  /** 進行中の目標だけを渡す。完了した目標には足せない */
  cards: GoalCard[];
  /** 閉じたときに呼ぶ。足した習慣を一覧へ反映させる */
  onClose: () => void;
}) {
  const [cardId, setCardId] = useState<string | null>(cards.length === 1 ? cards[0].id : null);
  // このシートを開く前からあった習慣は出さない。ここで足したものだけを並べる
  const before = useRef<Set<string>>(new Set());
  const [added, setAdded] = useState<Habit[]>([]);
  const [pickedAt, setPickedAt] = useState(0);

  const card = cards.find((c) => c.id === cardId) ?? null;

  useEffect(() => {
    if (!cardId) return;
    before.current = new Set(habitsOfCard(cardId).map((h) => h.id));
    setAdded([]);
    setPickedAt(Date.now());
  }, [cardId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const labelled = useMemo(
    () => cards.map((c) => ({ id: c.id, label: goalCardLabel(c) })),
    [cards],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="習慣を足す">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div className="relative flex max-h-[88vh] w-full max-w-[420px] flex-col rounded-t-2xl border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <h2 className="font-serif text-[16px] font-bold">習慣を足す</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto min-h-11 rounded-lg px-3 text-[13px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            閉じる
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {cards.length === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-[13.5px] leading-relaxed text-muted">
                習慣は、長期目標のためのものです。先に目標をつくってください。
              </p>
              <Link
                href="/goals"
                className="min-h-11 rounded-xl border border-line px-4 py-3 text-center text-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                目標を開く
              </Link>
            </div>
          ) : (
            <>
              <p className="mb-2 text-[12px] text-muted">どの長期目標のための習慣ですか</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="長期目標">
                {labelled.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={cardId === c.id}
                    onClick={() => setCardId(c.id)}
                    className={`min-h-11 max-w-full rounded-xl border px-3.5 text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                      cardId === c.id
                        ? "border-indigo bg-indigo-soft font-medium text-indigo"
                        : "border-line bg-paper text-muted"
                    }`}
                  >
                    <span className="block truncate">{c.label}</span>
                  </button>
                ))}
              </div>

              {card && (
                <div className="mt-5">
                  <p className="mb-2 text-[12px] text-muted">
                    「{goalCardLabel(card)}」の習慣
                  </p>
                  {/* 目標を選び直したら作り直す（別の目標の下書きを引きずらない） */}
                  <HabitEditor
                    key={`${card.id}-${pickedAt}`}
                    cardId={card.id}
                    habits={added}
                    startWithDraft
                    onChange={() =>
                      setAdded(habitsOfCard(card.id).filter((h) => !before.current.has(h.id)))
                    }
                  />
                  <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                    書いた内容はその場で保存されます。終わったら「閉じる」を押してください。
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
