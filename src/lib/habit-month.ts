import { addDays, toLocalDate } from "@/lib/date";
import {
  countsByWeek,
  findLog,
  habitStartDate,
  isScheduled,
  isWarmingUp,
} from "@/lib/habit";
import type { Habit, HabitLog } from "@/types/behavior";

/**
 * 月の見開き（習慣×日付のマス目）の判断。
 *
 * 見るだけの画面で、保存データは増やさない（読んで並べるだけ）。
 * 画面に出すものは全部ここで決め、画面側は描くだけにする。
 *
 * 数え方は habit.ts（computeRate / weekRate / isWarmingUp）と同じ約束に揃える。
 * 別の数え方をすると「習慣タブでは 80%、月の見開きでは 70%」と食い違い、
 * どちらを信じてよいか分からなくなる。
 */

/**
 * マスの種別。色だけに頼らず、形・記号・読み上げでも区別するために、
 * 見た目の違いを全部ここで別の値にしておく。
 *
 * - done / partial / missed / skipped … 記録の状態そのもの
 * - unrecorded … 予定日だが記録が無い（過去）
 * - open       … 今日で、まだ記録が無い（これからやれる。責めない）
 * - off        … 予定のない日（曜日指定の、予定外の曜日）
 * - none       … 週N回の、記録の無い日。曜日を決めない約束なので「予定のない日」にはしない
 * - future     … 明日以降
 * - before     … その習慣を作る前
 * - after      … やめた（畳んだ）あと
 */
export type MonthCellKind =
  | "done"
  | "partial"
  | "missed"
  | "skipped"
  | "unrecorded"
  | "open"
  | "off"
  | "none"
  | "future"
  | "before"
  | "after";

export interface MonthDay {
  date: string;
  /** 1〜月末 */
  day: number;
  /** 0=日 … 6=土 */
  dow: number;
  isToday: boolean;
  /** 月曜。週の区切りの線を引くのに使う */
  weekStart: boolean;
}

export interface MonthCell {
  date: string;
  kind: MonthCellKind;
  /** 予定外の日に記録がある（曜日指定の習慣で、決めた曜日以外にやった） */
  extra: boolean;
}

export interface MonthStats {
  /** その月にやった回数（done + partial）。予定外の日も含む */
  kept: number;
  done: number;
  partial: number;
  /** 数える単位。週N回だけ "week" */
  unit: "day" | "week";
  /** 率の分母。日なら予定日数、週なら週の目安の合計（回） */
  planned: number;
  /** 週N回: 率に使った週の数。日で数える習慣では 0 */
  weeks: number;
  /** 達成率（0〜1）。立ち上がり中・分母0・週N回で数える週が無いときは null */
  rate: number | null;
  /** 始めて14日未満（その月の終わり時点で判断）。true のあいだは率を出さない */
  warmingUp: boolean;
}

export interface MonthRow {
  habit: Habit;
  cells: MonthCell[];
  stats: MonthStats;
  /** 畳んだ、または完了した目標の習慣。その月に記録があるので出している */
  archived: boolean;
}

export interface MonthGrid {
  month: string;
  days: MonthDay[];
  rows: MonthRow[];
}

// ------------------------------------------------------------ 月の文字列

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * URL の `?m=` を読む。形が正しくない・範囲外なら fallback を返す（落とさない）。
 * 「2026-9」や「2026-13」を黙って別の月に直さず、既定の月に戻す。
 */
export function parseMonth(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const m = MONTH_RE.exec(raw);
  if (!m) return fallback;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12) return fallback;
  return raw;
}

/** "2026-10-10" → "2026-10" */
export const monthOf = (date: string): string => date.slice(0, 7);

/** 月を delta か月ずらす（年をまたぐ） */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${pad2(nm)}`;
}

/** 月の日数（うるう年を含む） */
export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  // 翌月の0日 = 当月末日
  return new Date(y, m, 0).getDate();
}

/** "2026年10月" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

// ------------------------------------------------------------ 組み立て

const kept = (state: string): boolean => state === "done" || state === "partial";

export interface BuildOptions {
  /**
   * 畳んでいないが、もう並べない習慣（完了した目標の習慣）。
   * 畳んだ習慣と同じく、その月に記録があるときだけ出す。
   * 日付で「やめたあと」にはしない（やめた日が分からないため）。
   */
  retiredIds?: ReadonlySet<string>;
}

/**
 * 月の見開きを組み立てる。
 *
 * ■ どの習慣を出すか
 * - 進行中の習慣: その月の終わりより前に作っていれば出す（記録が無くても）。
 *   作る前の月は、全部が「作る前」のマスになるだけなので出さない。
 * - 畳んだ習慣・完了した目標の習慣: **その月に記録があるときだけ**出す。
 *   消すと「あの月はこれをやっていた」が見えなくなる（畳む理由は、
 *   続かなかったことも記録だから）。一方、記録の無い月まで出し続けると、
 *   やめた習慣が空のマスで並び続け、見開きが「やっていないこと」で埋まる。
 *
 * ■ 記録が優先
 * 作る前・やめたあと・未来・予定外でも、記録のあるマスは記録の状態を出す。
 * 「やったのに空欄に見える」ほど腹の立つ壊れ方は無い。
 */
export function buildMonthGrid(
  habits: Habit[],
  logs: HabitLog[],
  month: string,
  today: string,
  opts: BuildOptions = {},
): MonthGrid {
  const n = daysInMonth(month);
  const days: MonthDay[] = [];
  for (let d = 1; d <= n; d++) {
    const date = `${month}-${pad2(d)}`;
    const dow = new Date(`${date}T00:00:00`).getDay();
    days.push({ date, day: d, dow, isToday: date === today, weekStart: dow === 1 });
  }
  const first = days[0].date;
  const last = days[n - 1].date;

  const rows: MonthRow[] = [];
  for (const habit of habits) {
    const monthLogs = logs.filter(
      (l) => l.habitId === habit.id && l.date >= first && l.date <= last,
    );
    const retired = Boolean(habit.archivedAt) || Boolean(opts.retiredIds?.has(habit.id));
    const start = habitStartDate(habit);
    if (retired) {
      if (monthLogs.length === 0) continue;
    } else if (monthLogs.length === 0 && start > last) {
      continue;
    }
    rows.push(buildRow(habit, logs, monthLogs, days, start, today, retired));
  }
  return { month, days, rows };
}

function buildRow(
  habit: Habit,
  allLogs: HabitLog[],
  monthLogs: HabitLog[],
  days: MonthDay[],
  start: string,
  today: string,
  retired: boolean,
): MonthRow {
  const weekly = countsByWeek(habit);
  const archiveDate = habit.archivedAt ? toLocalDate(new Date(habit.archivedAt)) : null;

  const cells: MonthCell[] = days.map(({ date }) => {
    const log = findLog(monthLogs, habit.id, date);
    if (log) {
      return {
        date,
        kind: log.state,
        extra: !weekly && !isScheduled(habit, date),
      };
    }
    let kind: MonthCellKind;
    if (date > today) kind = "future";
    else if (date < start) kind = "before";
    else if (archiveDate && date > archiveDate) kind = "after";
    else if (weekly) kind = "none";
    else if (!isScheduled(habit, date)) kind = "off";
    else if (date === today) kind = "open";
    else kind = "unrecorded";
    return { date, kind, extra: false };
  });

  const last = days[days.length - 1].date;
  // 立ち上がりは「その月の終わり（または今日）」の時点で判断する。
  // 今日で判断すると、9月の見開きの率が、10月に入った途端に突然出てしまう
  const ref = today < last ? today : last;
  const warmingUp = isWarmingUp(habit, ref);

  const done = monthLogs.filter((l) => l.state === "done").length;
  const partial = monthLogs.filter((l) => l.state === "partial").length;

  const { planned, achieved, weeks } = weekly
    ? weeklyCount(habit, allLogs, days, start, archiveDate, today)
    : dailyCount(habit, monthLogs, days, start, archiveDate, today);

  return {
    habit,
    cells,
    archived: retired,
    stats: {
      kept: done + partial,
      done,
      partial,
      unit: weekly ? "week" : "day",
      planned,
      weeks,
      rate: warmingUp || planned === 0 ? null : achieved / planned,
      warmingUp,
    },
  };
}

/**
 * 日で数える習慣。habit.ts の computeRate と同じ約束を、その月の範囲で数える。
 * - 予定日だけを数える。休み（skipped）は分母から外す
 * - 今日の未記録は分母に入れない（まだ結果が出ていない）
 * - 作成日は、やった記録があるときだけ分母・分子に入れる
 * - 予定外の日にやった分は回数には入るが、率の分子には入れない（100%超を防ぐ）
 */
function dailyCount(
  habit: Habit,
  monthLogs: HabitLog[],
  days: MonthDay[],
  start: string,
  archiveDate: string | null,
  today: string,
): { planned: number; achieved: number; weeks: number } {
  let planned = 0;
  let achieved = 0;
  for (const { date } of days) {
    if (date > today) break;
    if (date < start) continue;
    if (archiveDate && date > archiveDate) continue;
    if (!isScheduled(habit, date)) continue;
    const log = findLog(monthLogs, habit.id, date);
    if (date === start) {
      if (log && kept(log.state)) {
        planned++;
        achieved++;
      }
      continue;
    }
    if (log?.state === "skipped") continue;
    if (date === today && !log) continue;
    planned++;
    if (log && kept(log.state)) achieved++;
  }
  return { planned, achieved, weeks: 0 };
}

/**
 * 週N回の習慣。月の頭と終わりは週が切れるので、
 * 「月に丸ごと収まる、終わった週」だけで数える（habit.ts の weekRate と同じく、
 * 作った週は入れず、1週の分子は目安で頭打ち）。
 * 回数（kept）は月の中のやった日を全部数えるので、率に入らない日も落とさない。
 */
function weeklyCount(
  habit: Habit,
  allLogs: HabitLog[],
  days: MonthDay[],
  start: string,
  archiveDate: string | null,
  today: string,
): { planned: number; achieved: number; weeks: number } {
  const target = habit.schedule.kind === "timesPerWeek" ? Math.max(1, habit.schedule.times) : 0;
  const lastDay = days[days.length - 1].date;
  const startWeek = weekStartOf(start);
  let planned = 0;
  let achieved = 0;
  let weeks = 0;
  for (const d of days) {
    if (!d.weekStart) continue;
    const weekStart = d.date;
    const weekEnd = addDays(6, new Date(`${weekStart}T00:00:00`));
    if (weekEnd > lastDay) continue; // 月をまたぐ週
    if (weekEnd >= today) continue; // まだ終わっていない週
    if (weekStart <= startWeek) continue; // 作った週は途中から
    if (archiveDate && weekEnd > archiveDate) continue; // やめたあとの週
    const keptInWeek = allLogs.filter(
      (l) =>
        l.habitId === habit.id && l.date >= weekStart && l.date <= weekEnd && kept(l.state),
    ).length;
    planned += target;
    achieved += Math.min(target, keptInWeek);
    weeks++;
  }
  return { planned, achieved, weeks };
}

/** その日を含む週の月曜 */
function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return toLocalDate(d);
}

// ------------------------------------------------------------ 並べ方

/**
 * 長期目標ごとにまとめる。
 * 目標の並びは cardOrder に従い、そこに無い目標（消えた目標の習慣）は最後に
 * 出てきた順で並べる。まとまりの中は、習慣を作った順。
 */
export function groupRowsByCard(
  rows: MonthRow[],
  cardOrder: string[],
): { cardId: string; rows: MonthRow[] }[] {
  const byCard = new Map<string, MonthRow[]>();
  for (const r of rows) {
    const list = byCard.get(r.habit.cardId) ?? [];
    list.push(r);
    byCard.set(r.habit.cardId, list);
  }
  const ids = [
    ...cardOrder.filter((id) => byCard.has(id)),
    ...[...byCard.keys()].filter((id) => !cardOrder.includes(id)),
  ];
  return ids.map((cardId) => ({
    cardId,
    rows: (byCard.get(cardId) ?? []).slice().sort((a, b) =>
      a.habit.createdAt === b.habit.createdAt
        ? a.habit.id.localeCompare(b.habit.id)
        : a.habit.createdAt.localeCompare(b.habit.createdAt),
    ),
  }));
}
