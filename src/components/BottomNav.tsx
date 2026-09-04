"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 下タブ。
 *
 * 上のナビから下へ移した理由は2つ。
 * ① 画面幅を420pxに固定しているのに操作系が最上部にあり、片手の親指が届かない
 * ② 以前は「ホーム / ツリー / 記録 / 設定」の4つが並んでいたが、
 *    ツリーは場所ではなくビュー（ホームと同じデータの別の見せ方）で、
 *    設定は毎日のナビに枠を使う頻度ではなかった
 *
 * 3つに絞ったのは、頻度の桁が違うものを同列に置かないため。
 * 「決める」（AI対話）は月1回なので、タブを持たず目標タブから入る。
 */
const NAV = [
  { href: "/", label: "今日", icon: TodayIcon },
  { href: "/goals", label: "目標", icon: GoalIcon },
  { href: "/me", label: "わたし", icon: MeIcon },
] as const;

/**
 * タブを隠す画面。
 * 対話中と、AIが整理している最中。ここで移動されると、走っている生成が
 * 捨てられて中途半端な状態が残る。出したうえで無効化するより、
 * そもそも出さないほうが誤操作が起きない。
 */
const HIDE_ON = ["/session", "/card", "/big"];

export function BottomNav() {
  const pathname = usePathname();
  if (HIDE_ON.some((p) => pathname.startsWith(p))) return null;

  return (
    <nav data-below-grid
      aria-label="メインナビゲーション"
      className="sticky bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="phone flex" style={{ height: "var(--bottom-nav-h)" }}>
        {NAV.map((n) => {
          // 「今日」は "/" と時間割（/plan）。他は配下も光らせる
          const on =
            n.href === "/"
              ? pathname === "/" || pathname.startsWith("/plan")
              : pathname.startsWith(n.href);
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={on ? "page" : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-1 text-[11px] transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                on ? "text-accent" : "text-muted"
              }`}
            >
              <Icon active={on} />
              <span className={on ? "font-medium" : ""}>{n.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/*
 * アイコンは線画のまま。塗りつぶすと、6人のコーチのアバターと
 * 情報の強さが並んでしまい、画面の主役が下に来てしまう。
 */
const stroke = (active: boolean) => (active ? 2 : 1.5);

function TodayIcon({ active }: { active: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3.5" y="5" width="17" height="15" rx="2.5"
        stroke="currentColor" strokeWidth={stroke(active)}
      />
      <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth={stroke(active)} />
      <path d="M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth={stroke(active)} strokeLinecap="round" />
      {active && <circle cx="12" cy="14.5" r="2.2" fill="currentColor" />}
    </svg>
  );
}

function GoalIcon({ active }: { active: boolean }) {
  // 幹と枝。このアプリの中心概念（物語に目標がぶら下がる）をそのまま出す
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 20.5V6" stroke="currentColor" strokeWidth={stroke(active)} strokeLinecap="round" />
      <path d="M12 12.5c0-2.2 1.8-4 4-4h2.5" stroke="currentColor" strokeWidth={stroke(active)} strokeLinecap="round" />
      <path d="M12 16.5c0-1.7-1.4-3-3-3H6.5" stroke="currentColor" strokeWidth={stroke(active)} strokeLinecap="round" />
      <circle cx="12" cy="4.5" r="2" stroke="currentColor" strokeWidth={stroke(active)} fill={active ? "currentColor" : "none"} />
    </svg>
  );
}

function MeIcon({ active }: { active: boolean }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.6" stroke="currentColor" strokeWidth={stroke(active)} fill={active ? "currentColor" : "none"} />
      <path d="M4.8 20c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6" stroke="currentColor" strokeWidth={stroke(active)} strokeLinecap="round" />
    </svg>
  );
}
