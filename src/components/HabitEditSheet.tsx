"use client";

import { useEffect, useState } from "react";
import { HabitEditor } from "@/components/HabitEditor";
import { loadHabits } from "@/lib/storage";
import type { Habit } from "@/types/behavior";

/**
 * 習慣タブから、すでにある習慣そのものを直すシート。
 *
 * 今日の記録（やった・できなかった）を直すのは一覧の行そのもの。
 * こちらは習慣の定義（名前・最小版・いつ・どこで・きっかけ・やめる）を直す。
 * 入力の部品は目標の詳細画面・追加シートと同じ HabitEditor で、
 * 欄を離れると保存される。
 */
export function HabitEditSheet({
  habit,
  onClose,
}: {
  habit: Habit;
  /** 閉じたときに呼ぶ。直した内容を一覧へ反映させる */
  onClose: () => void;
}) {
  // 保存のたびに読み直す。HabitEditor は渡された値を元に差分を作るので、古いままだと上書きで戻る
  const [current, setCurrent] = useState<Habit>(habit);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function refresh() {
    const next = loadHabits().find((h) => h.id === habit.id);
    // やめた（畳んだ）あとは直す対象が無い。そのまま閉じる
    if (!next || next.archivedAt) {
      onClose();
      return;
    }
    setCurrent(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label="習慣を直す">
      <button
        type="button"
        aria-label="閉じる"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div className="relative flex max-h-[88vh] w-full max-w-[420px] flex-col rounded-t-2xl border border-line bg-surface">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <h2 className="font-serif text-[16px] font-bold">習慣を直す</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto min-h-11 rounded-lg px-3 text-[13px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            閉じる
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <HabitEditor cardId={current.cardId} habits={[current]} onChange={refresh} hideAdd />
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
            書いた内容は、欄を離れると保存されます。終わったら「閉じる」を押してください。
          </p>
        </div>
      </div>
    </div>
  );
}
