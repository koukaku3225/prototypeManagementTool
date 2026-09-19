import { rolledDay, toLocalDate } from "@/lib/date";

/**
 * 「開いたまま日付が変わった」を、1回だけ知らせる番人。
 *
 * 画面が「今日」として読み込んだ日を覚えておき、check() のたびにいまの日付と
 * 見比べる。違っていたら onNewDay(新しい今日, 読み込んでいた日) を呼び、
 * 覚えている日を新しい今日に進める（同じ日のあいだは何度 check しても呼ばない）。
 *
 * 画面のイベント（visibilitychange など）との結びつきは hooks/useDayRollover.ts。
 * 判断だけをここに置いているのは、時計を差し替えて全通りをテストできるようにするため。
 */
export function createDayWatcher(
  onNewDay: (nowDay: string, prevDay: string) => void,
  now: () => Date = () => new Date(),
) {
  let loaded = toLocalDate(now());
  return {
    /** 日付が変わっていれば onNewDay を呼んで true を返す */
    check(): boolean {
      const next = rolledDay(loaded, now());
      if (next === null) return false;
      const prev = loaded;
      loaded = next;
      onNewDay(next, prev);
      return true;
    },
  };
}
