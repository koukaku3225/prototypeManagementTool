import Link from "next/link";

/**
 * 存在しないURL。
 * 目標や対話を消したあとに、古いリンク（/goal/<消したID>）を踏むと来る。
 * 「無い」だけでなく「消した可能性がある」ことまで書く。
 */
export default function NotFound() {
  return (
    <main className="phone flex flex-1 flex-col justify-center gap-5 px-5 py-14">
      <div>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-muted">
          Not Found
        </p>
        <h1 className="mt-2 font-serif text-[22px] leading-[1.5] font-bold">
          このページはありません
        </h1>
      </div>

      <p className="text-[14px] leading-relaxed text-muted">
        目標や対話を消したあとに、古いリンクを開くとここに来ます。
        ホームから探し直してください。
      </p>

      <Link
        href="/"
        className="rounded-xl bg-indigo px-4 py-3.5 text-center text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        ホームへ戻る
      </Link>
    </main>
  );
}
