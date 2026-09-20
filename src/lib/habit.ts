import { addDays, diffDays, startOfWeek, toLocalDate, today as todayStr } from "@/lib/date";
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
/** 達成率を出す期間（日で数える習慣） */
export const RATE_WINDOW = 30;
/**
 * 達成率を出す期間（週で数える習慣）。終わった週だけを数えるので、
 * 30日ぶんに近く、ヒートマップの「直近5週間」からもはみ出さない4週にしてある。
 */
export const RATE_WEEKS = 4;
/**
 * 率とヒートマップを出し始めるまでの日数。
 * 始めた翌日に「達成率 0%」を見せるのは、続ける気を削ぐだけで情報がない。
 */
export const WARMUP_DAYS = 14;

/**
 * その習慣を作った日（この端末のローカル日付、YYYY-MM-DD）。
 *
 * `createdAt` は `new Date().toISOString()` の**UTC**文字列なので、
 * 先頭10文字を切り出すと JST の朝9時までが前日になる。
 * 実際に次の2つの形で表に出ていた。
 *
 *   - 深夜〜朝に作った習慣が「はじめて1日目」から始まる（作った瞬間に1日目）
 *   - 同じ習慣でも、作った時刻しだいで作成日そのものが
 *     ストリークと達成率の対象に入ったり入らなかったりする
 *     （作成日の扱いは下の computeStreak / computeRate を参照）
 *
 * AGENTS.md の「日付は date.ts のヘルパーを通す」はここにも掛かる。
 * 瞬間（UTC）を、この端末の暦の日に直してから比べる。
 */
export const habitStartDate = (habit: Habit): string =>
  toLocalDate(new Date(habit.createdAt));

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
 * 数える単位。週N回だけ「週」で、ほかは「日」。
 *
 * 週N回は曜日を決めない約束なので、日で数えると破綻する。
 * 予定日が週7日ぶんあることになり、きっちり週3回やっていても
 * 達成率は 3/7＝43%、連続は「やらない日」が来た時点で切れて最大2日にしかならない。
 * 実際に「毎週きっちり3回を5週」続けた記録で「45% ・ 2日連続 ・ 保険を使用中」と
 * 出ていた（2026-09-21 に実機で確認）。約束が週単位なら、数える単位も週にする。
 */
export const countsByWeek = (habit: Pick<Habit, "schedule">): boolean =>
  habit.schedule.kind === "timesPerWeek";

/** 週N回の「何回」。ほかの種類では使わない */
const weeklyTarget = (habit: Habit): number =>
  habit.schedule.kind === "timesPerWeek" ? Math.max(1, habit.schedule.times) : 0;

/** その日を含む週の月曜（date.ts の週の始まりに合わせる） */
const weekStartOf = (date: string): string => startOfWeek(new Date(`${date}T00:00:00`));

/** i 週前の月曜 */
const weekBefore = (thisWeekStart: string, i: number): string =>
  addDays(-7 * i, new Date(`${thisWeekStart}T00:00:00`));

/**
 * その週にやった回数（done / partial）。
 *
 * skipped は数に入れないが、分母（週の目安）も減らさない。
 * 週N回は「その週のうちどこかで n 回」という約束なので、
 * 1日休むことは約束の妨げにならない。
 */
function keptInWeek(habit: Habit, logs: HabitLog[], weekStart: string): number {
  const weekEnd = addDays(6, new Date(`${weekStart}T00:00:00`));
  return logs.filter(
    (l) =>
      l.habitId === habit.id && l.date >= weekStart && l.date <= weekEnd && kept(l.state),
  ).length;
}

/**
 * 週N回のストリーク。続いた「週」の数を返す。
 *
 * - 今週はまだ途中なので、目安に届いていなくても途切れにしない
 *   （すでに届いていれば、その週も数に入れる）
 * - 作った週は途中から始まっていて目安に届きようがないので、数えずに止める
 * - 保険は日のときと同じ考えで1回だけ。ただし守れるのは直前の週まで
 *   （日のときの「直近7日以内」＝1区切りぶんに対応する）
 */
function weekStreak(
  habit: Habit,
  logs: HabitLog[],
  today: string,
): { streak: number; freezeUsed: boolean } {
  const target = weeklyTarget(habit);
  const startWeek = weekStartOf(habitStartDate(habit));
  const thisWeek = weekStartOf(today);
  let streak = 0;
  let freezeUsed = false;
  for (let i = 0; i < 200; i++) {
    const week = weekBefore(thisWeek, i);
    if (week < startWeek) break;
    const met = keptInWeek(habit, logs, week) >= target;
    if (met) {
      streak++;
      continue;
    }
    if (i === 0) continue; // 今週はこれからやれる
    if (week === startWeek) break; // 作った週は途中から。届かなくても責めない
    if (!freezeUsed && i <= 1) {
      freezeUsed = true;
      continue;
    }
    break;
  }
  // 日のときと同じ。続いていないなら守るものが無いので、保険は消費していない
  return { streak, freezeUsed: streak > 0 && freezeUsed };
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
  if (countsByWeek(habit)) return weekStreak(habit, logs, today);
  let streak = 0;
  let freezeUsed = false;
  const start = habitStartDate(habit);
  // 今日はまだやっていないだけかもしれないので、今日の未記録は途切れにしない
  for (let i = 0; i < 400; i++) {
    const date = addDays(-i, new Date(`${today}T00:00:00`));
    // 作る前まで遡らない
    if (date < start) break;
    if (!isScheduled(habit, date)) continue;
    const log = findLog(logs, habit.id, date);
    /*
     * 作成日は「やった記録があるときだけ」数える（R2' 案C）。
     * 朝に作ってその日にやった人に手応えを返す一方、夜に作ってやらなかった日を
     * 途切れや保険の消費にはしない。どちらにしても作成日より前は無いので止める。
     */
    if (date === start) {
      if (log && kept(log.state)) streak++;
      break;
    }

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
  /*
   * 保険は「続いているもの」を守るための仕組み。連続が0日なら守るものが無いので、
   * 消費したことにしない。ここで true を返すと、わたし画面に
   * 「0日連続 ・ 保険を使用中」という意味の通らない組み合わせが出る。
   */
  return { streak, freezeUsed: streak > 0 && freezeUsed };
}

/**
 * 達成率と、その分母（planned）。
 *
 * 日で数える習慣は直近 RATE_WINDOW 日の予定日、
 * 週で数える習慣（週N回）は終わった直近 RATE_WEEKS 週ぶんの回数が分母になる。
 * planned の単位は countsByWeek() で分かれる（日 / 回）ので、
 * 画面に出すときは単位も一緒に出しわけること。
 */
export function computeRate(
  habit: Habit,
  logs: HabitLog[],
  today = todayStr(),
): { rate: number; planned: number } {
  if (countsByWeek(habit)) return weekRate(habit, logs, today);
  const base = new Date(`${today}T00:00:00`);
  const start = habitStartDate(habit);
  let scheduled = 0;
  let achieved = 0;
  for (let i = 0; i < RATE_WINDOW; i++) {
    const date = addDays(-i, base);
    /*
     * 始める前は数えない。作った瞬間に過去が全部 missed になるのを防ぐ。
     */
    if (date < start) break;
    if (!isScheduled(habit, date)) continue;
    const log = findLog(logs, habit.id, date);
    /*
     * 作成日は done / partial の記録があるときだけ分母・分子に入れる（R2' 案C）。
     * 夜に作った習慣を、その日のうちに「できなかった」と数えるのは筋が通らない。
     */
    if (date === start) {
      if (log && kept(log.state)) {
        scheduled++;
        achieved++;
      }
      break;
    }
    if (log?.state === "skipped") continue;
    // 今日ぶんはまだ結果が出ていないので分母に入れない
    if (i === 0 && !log) continue;
    scheduled++;
    if (log && kept(log.state)) achieved++;
  }
  return { rate: scheduled === 0 ? 0 : achieved / scheduled, planned: scheduled };
}

/**
 * 週N回の達成率。終わった週だけを、週の目安を分母にして数える。
 *
 * 今週を入れないのは、日のときに「今日ぶんはまだ結果が出ていない」として
 * 分母から外しているのと同じ理由。週の半ばに見ると必ず下がって見える。
 * 1週に目安より多くやっても、その週ぶんは目安どまりで数える
 * （前倒しで率を水増ししない）。
 */
function weekRate(
  habit: Habit,
  logs: HabitLog[],
  today: string,
): { rate: number; planned: number } {
  const target = weeklyTarget(habit);
  const startWeek = weekStartOf(habitStartDate(habit));
  const thisWeek = weekStartOf(today);
  let planned = 0;
  let achieved = 0;
  for (let i = 1; i <= RATE_WEEKS; i++) {
    const week = weekBefore(thisWeek, i);
    // 作った週は途中から始まっているので、率の分母にも入れない
    if (week <= startWeek) break;
    planned += target;
    achieved += Math.min(target, keptInWeek(habit, logs, week));
  }
  return { rate: planned === 0 ? 0 : achieved / planned, planned };
}

export function computeStats(
  habit: Habit,
  logs: HabitLog[],
  today = todayStr(),
): HabitStats {
  const { rate, planned } = computeRate(habit, logs, today);
  const { streak, freezeUsed } = computeStreak(habit, logs, today);
  const todayLog = findLog(logs, habit.id, today);
  // 週N回だけ、今週あと何回かを持つ。日で数える習慣には無い
  const thisWeek = countsByWeek(habit)
    ? {
        done: keptInWeek(habit, logs, weekStartOf(today)),
        target: weeklyTarget(habit),
      }
    : null;
  return {
    unit: countsByWeek(habit) ? "week" : "day",
    rate,
    planned,
    streak,
    freezeLeft: freezeUsed ? 0 : 1,
    /*
     * 週N回は今週の目安に届いたら、今日の一覧から外す。外さないと、届いた週の
     * 残りの日も「今日の習慣 0/1」が居座って、約束を守っているのに未完了に見える。
     * 今日すでに記録したものは残す（押した結果が消えると、押したのか分からなくなる）。
     */
    dueToday:
      isScheduled(habit, today) &&
      (!thisWeek || thisWeek.done < thisWeek.target || todayLog !== null),
    todayLog,
    thisWeek,
  };
}

/** 始めてから何日経ったか。率を出してよいかの判断に使う */
export const daysSinceStart = (habit: Habit, today = todayStr()): number =>
  diffDays(habitStartDate(habit), today);

export const isWarmingUp = (habit: Habit, today = todayStr()): boolean =>
  daysSinceStart(habit, today) < WARMUP_DAYS;

/**
 * ヒートマップ用に、直近 n 日ぶんを古い順で返す。
 * 予定日でない日は state を null にして、薄く描けるようにする。
 * 週N回は曜日を決めないので、どの日も「予定日ではない」側に出す。
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
      /*
       * 週N回は曜日を決めない約束なので、記録のない日を「やるはずだった日」の
       * 空欄として描かない。描くと、きっちり守っている人でも週に4マスが「できなかった」
       * ように並ぶ（達成率を週で数えるようにしたのと同じ理由）。
       */
      scheduled: !countsByWeek(habit) && isScheduled(habit, date),
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
