/**
 * ページの読み込み中。
 *
 * 文字を出さないのは、一瞬で消えるものに文言があると
 * ちらついて読ませようとしてしまうため。
 * aria-busy と視覚的に隠したテキストで、読み上げ側にだけ伝える。
 */
export default function Loading() {
  return (
    <main
      className="phone flex flex-1 items-center justify-center px-5 py-20"
      aria-busy="true"
    >
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 animate-pulse rounded-full bg-accent"
            style={{ animationDelay: `${i * 160}ms` }}
          />
        ))}
      </div>
      <span className="sr-only">読み込んでいます</span>
    </main>
  );
}
