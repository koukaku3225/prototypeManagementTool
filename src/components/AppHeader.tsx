"use client";

import { useEffect } from "react";

/**
 * 画面の見出し帯。
 *
 * 以前はここにナビが同居していたが、下タブ（BottomNav）へ移した。
 * 画面幅を420pxに固定しているのに操作系が最上部にあり、片手では届かない。
 * ここに残すのは「いまどの画面にいるか」だけ。
 *
 * locked を立てている間は下タブごと隠す（layout ではなく呼び出し側で判断）。
 * AIが整理している最中に画面を移られると、走っている生成が捨てられて
 * 中途半端な状態が残るため。
 */

export function AppHeader({
  title,
  locked,
  lockedNote,
}: {
  title?: string;
  locked?: boolean;
  lockedNote?: string;
}) {
  // リロードや戻るでも取りこぼさないよう、ブラウザ側にも確認を出す
  useEffect(() => {
    if (!locked) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [locked]);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur">
      <div className="phone flex items-center gap-3 px-5 py-2.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">
          {title ?? "目標設定コーチ"}
        </span>

        {locked ? (
          <span
            className="ml-auto text-[11.5px] text-muted"
            role="status"
            aria-live="polite"
          >
            {lockedNote ?? "処理中は移動できません"}
          </span>
        ) : null}
      </div>
    </header>
  );
}
