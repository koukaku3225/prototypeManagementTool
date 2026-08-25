"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 全画面共通のナビ。
 * 以前は /card から /home への一方通行しかなく、目標を見たあとに
 * どこへも行けなくなっていた。どの画面からでもホームに戻れるようにする。
 *
 * locked を立てている間は移動させない。AIが整理している最中に画面を
 * 移られると、走っている生成が捨てられて中途半端な状態が残るため。
 */
const NAV = [
  { href: "/", label: "ホーム" },
  { href: "/tree", label: "ツリー" },
  { href: "/history", label: "記録" },
  { href: "/settings", label: "設定" },
] as const;

export function AppHeader({
  title,
  locked,
  lockedNote,
}: {
  title?: string;
  locked?: boolean;
  lockedNote?: string;
}) {
  const pathname = usePathname();

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
        ) : (
          <nav className="ml-auto flex items-center gap-1">
            {NAV.map((n) => {
              const on = pathname === n.href;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={on ? "page" : undefined}
                  className={`rounded-lg px-2.5 py-1 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    on
                      ? "bg-accent-soft text-accent"
                      : "text-muted hover:text-[color:var(--fg)]"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
