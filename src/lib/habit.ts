import { addDays, diffDays, today as todayStr } from "@/lib/date";
import type {
  Habit,
  HabitLog,
  HabitLogState,
  HabitStats,
} from "@/types/behavior";

/**
 * 習慣の集計。
 *
 * ぜんぶ純粋関数にしてある。日付の境界とストリークの数え方は、
 * 目で見ても正しさが分からないうえに、間違うと
 * 「続いているのに途切れたと言われる」という、いちばん腹の立つ壊れ方をする。
 * tests/habit.test.mjs で固定してある。
 */

/** 保険（フリーズ）を使える頻度。直近この日数につき1回 */
const FREEZE_WINDOW = 7;
/** 達成率を出す期間 */
const RATE_WINDOW = 30;
/**
 * 率とヒートマップを出し始めるまでの日数。
 * 始めた翌日に「達成率 0%」を見せるのは、続ける気を削ぐだけで情報がない。
 */
export const WARMUP_DAYS = 14;

/** その日が予定日か。timesPerWeek は「曜日を問わない」ので常に予定日扱い */
export function isScheduled(habit: Habit, date: string): boolean {
  const s = habit.schedule;
  if (s.kind === "daily") return true;
  if (s.kind === "timesPerWeek") return true;
  const dow = new Date(`${date}T00:00:00`).getDay();
  return s.days.includes(dow);
}

/** 途切れとみなさない状態 */
const kept = (state: HabitLogState): boolean =>
  state === "done" || state === "partial";

/** habitId と日付で1件引く */
export function findLog(
  logs: HabitLog[],
  habitId: string,
  date: string,
): HabitLog | null {
  return logs.find((l) => l.habitId === habitId && l.date === date) ?? null;
}

/**
 * ストリーク。予定日だけを数える。
 *
 * 予定日でない日は「飛ばす」（途切れでも継続でもない）。
 * skipped も飛ばす。本人が「今日はやらない」と決めた日を失敗にしない。
 *
 * 保険: 直近 FREEZE_WINDOW 日に1回だけ、missed を無かったことにする。
 * これが無いと、1日崩れた瞬間にゼロになり「どうせ途切れたから」と
 * 離脱が加速する（what-the-hell 効果）。
 */
export function computeStreak(
  habit: Habit,
  logs: HabitLog[],
  today = todayStr(),
): { streak: number; freezeUsed: boolean } {
  let streak = 0;
  let freezeUsed = false;
  const start = habit.createdAt.slice(0, 10);
  // 今日はまだやっていないだけかもしれないので、今日の未記録は途切れにしない
  for (let i = 0; i < 400; i++) {
    const date = addDays(-i, new Date(`${today}T00:00:00`));
    // 作る前まで遡らない。作成日そのものも数えない（その日はもう終わりかけ）
    if (date <= start) break;
    if (!isScheduled(habit, date)) continue;
    const log = findLog(logs, habit.id, date);

    if (log && kept(log.state)) {
      streak++;
      continue;
    }
    if (log && log.state === "skipped") continue;

    // 記録が無い、または missed
    if (i === 0) continue; // 今日はこれからやれる
    if (!freezeUsed) {
      // 保険を1回だけ使う。ただし直近 FREEZE_WINDOW 日以内の途切れに限る
      if (i <= FREEZE_WINDOW) {
        freezeUsed = true;
        continue;
      }
    }
    break;
  }
  return { streak, freezeUsed };
}

/** 直近 RATE_WINDOW 日の達成率。分母は予定日から skipped を除いたもの */
export function computeRate(
  habit: Habit,
  logs: HabitLog[],
  today = todayStr(),
): { rate: number; scheduled: number } {
  const base = new Date(`${today}T00:00:00`);
  const start = habit.createdAt.slice(0, 10);
  let scheduled = 0;
  let achieved = 0;
  for (let i = 0; i < RATE_WINDOW; i++) {
    const date = addDays(-i, base);
    /*
     * 始める前は数えない。作った瞬間に過去が全部 missed になるのを防ぐ。
     * 作成日そのものも外す。夜に作った習慣を、その日のうちに
     * 「できなかった」と数えるのは筋が通らない。
     */
    if (date <= start) break;
    if (!isScheduled(habit, date)) continue;
    const log = findLog(logs, habit.id, date);
    if (log?.state === "skipped") continue;
    // 今日ぶんはまだ結果が出ていないので分母に入れない
    if (i === 0 && !log) continue;
    scheduled++;
    if (log && kept(log.state)) achieved++;
  }
  return { rate: scheduled === 0 ? 0 : achieved / scheduled, scheduled };
}

export function computeStats(
  habit: Habit,
  logs: HabitLog[],
  today = todayStr(),
): HabitStats {
  const { rate, scheduled } = computeRate(habit, logs, today);
  const { streak, freezeUsed } = computeStreak(habit, logs, today);
  return {
    rate30: rate,
    scheduled30: scheduled,
    streak,
    freezeLeft: freezeUsed ? 0 : 1,
    dueToday: isScheduled(habit, today),
    todayLog: findLog(logs, habit.id, today),
  };
}

/** 始めてから何日経ったか。率を出してよいかの判断に使う */
export const daysSinceStart = (habit: Habit, today = todayStr()): number =>
  diffDays(habit.createdAt.slice(0, 10), today);

export const isWarmingUp = (habit: Habit, today = todayStr()): boolean =>
  daysSinceStart(habit, today) < WARMUP_DAYS;

/**
 * ヒートマップ用に、直近 n 日ぶんを古い順で返す。
 * 予定日でない日は state を null にして、薄く描けるようにする。
 */
export function heatmap(
  habit: Habit,
  logs: HabitLog[],
  days = 35,
  today = todayStr(),
): { date: string; state: HabitLogState | null; scheduled: boolean }[] {
  const base = new Date(`${today}T00:00:00`);
  const out: { date: string; state: HabitLogState | null; scheduled: boolean }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(-i, base);
    out.push({
      date,
      state: findLog(logs, habit.id, date)?.state ?? null,
      scheduled: isScheduled(habit, date),
    });
  }
  return out;
}

/** 週あたり何回やる予定か。3目標の負荷を見るのに使う */
export function timesPerWeek(habit: Habit): number {
  const s = habit.schedule;
  if (s.kind === "daily") return 7;
  if (s.kind === "weekdays") return s.days.length;
  return s.times;
}

/** 人が読む形の繰り返し */
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
export function scheduleLabel(habit: Habit): string {
  const s = habit.schedule;
  if (s.kind === "daily") return "毎日";
  if (s.kind === "timesPerWeek") return `週${s.times}回`;
  if (s.days.length === 0) return "予定なし";
  if (s.days.length === 7) return "毎日";
  return s.days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => DOW[d])
    .join("・");
}
