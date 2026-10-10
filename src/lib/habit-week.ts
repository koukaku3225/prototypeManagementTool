import { addDays, toLocalDate } from "@/lib/date";
import {
  countsByWeek,
  habitStartDate,
  isScheduled,
  isWarmingUp,
} from "@/lib/habit";
import type { Habit, HabitLog, WeeklyReview } from "@/types/behavior";
import type { TimeBox } from "@/types/timebox";

/**
 * 週のふりかえりの判断。
 *
 * 数字は読んで並べるだけ（保存しない）。保存するのは本人が書いた2つの一言だけ
 * （WeeklyReview）。画面に出すものは全部ここで決め、画面側は描くだけにする。
 *
 * 数え方は habit.ts / habit-month.ts と同じ約束に揃える。別の数え方をすると
 * 「習慣タブでは続いているのに、ふりかえりでは足りない」と食い違い、
 * どちらを信じてよいか分からなくなる。
 *
 * 責めない: できなかった回数は事実として数えるだけで、良し悪しの判定は返さない。
 */

// ------------------------------------------------------------ 週の範囲

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** 実在する YYYY-MM-DD か（2026-02-30 や年の範囲外は false） */
function isRealDate(raw: string): boolean {
  const m = DATE_RE.exec(raw);
  if (!m) return false;
  const y = Number(m[1]);
  if (y < MIN_YEAR || y > MAX_YEAR) return false;
  return toLocalDate(new Date(`${raw}T00:00:00`)) === raw;
}

/** その日を含む週の月曜（月曜始まり。日曜は前の月曜） */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return toLocalDate(d);
}

/** 月曜から日曜までの7日 */
export function weekDates(weekStart: string): string[] {
  const base = new Date(`${weekStart}T00:00:00`);
  return Array.from({ length: 7 }, (_, i) => addDays(i, base));
}

/** 週を delta 週ずらす（月またぎ・年またぎを含む） */
export function shiftWeek(weekStart: string, delta: number): string {
  return addDays(7 * delta, new Date(`${weekStart}T00:00:00`));
}

/**
 * URL の `?w=` を読む。月曜でない日付は、その日を含む週の月曜に丸める。
 * 形が正しくない・実在しない・範囲外なら今週に戻す（落とさない）。
 */
export function parseWeek(raw: string | null | undefined, today: string): string {
  if (raw && isRealDate(raw)) return mondayOf(raw);
  return mondayOf(today);
}

/** "10/5〜10/11"。年をまたぐ週だけ年を付ける */
export function weekRangeLabel(weekStart: string): string {
  const end = weekDates(weekStart)[6];
  const [y1, m1, d1] = weekStart.split("-").map(Number);
  const [y2, m2, d2] = end.split("-").map(Number);
  if (y1 !== y2) return `${y1}/${m1}/${d1}〜${y2}/${m2}/${d2}`;
  return `${m1}/${d1}〜${m2}/${d2}`;
}

export type WeekPhase = "past" | "current" | "future";

export function weekPhase(weekStart: string, today: string): WeekPhase {
  const thisWeek = mondayOf(today);
  if (weekStart < thisWeek) return "past";
  if (weekStart > thisWeek) return "future";
  return "current";
}

/**
 * ふりかえりを書いてよい週か。今週と過去の週はよい。
 * まだ始まっていない週に「ふりかえり」を書かせない。
 */
export const canWriteReview = (weekStart: string, today: string): boolean =>
  weekPhase(weekStart, today) !== "future";

// ------------------------------------------------------------ 数字

export interface WeekSummary {
  weekStart: string;
  phase: WeekPhase;
  /** 数に入れた習慣の数（立ち上がり中も含む） */
  habitCount: number;
  /** 率の分母。日で数える習慣は予定日、週N回は週の目安（回）。立ち上がり中は入れない */
  planned: number;
  /** 率の分子。予定日にやった（done + partial）回数。週N回は目安で頭打ち */
  achieved: number;
  /** achieved / planned。分母0なら null（0% と出さない） */
  rate: number | null;
  /** その週にやった回数（done + partial）。立ち上がり中・予定外の日も含む */
  kept: number;
  done: number;
  /** 最小版でやった回数 */
  partial: number;
  /** できなかった回数（記録した missed）。事実として数えるだけ */
  missed: number;
  /** 休んだ回数 */
  skipped: number;
  /** 曜日指定の習慣で、決めた曜日以外にやった回数 */
  extra: number;
  /** 率に入れなかった、始めて14日未満の習慣の数 */
  warmingUpCount: number;
  /** 時間割の枠の「できばえ」の平均（整数）。入っている枠が無ければ null */
  scoreAvg: number | null;
  scoreCount: number;
}

export interface WeekOptions {
  /**
   * 畳んでいないが、もう並べない習慣（完了した目標の習慣）。
   * 畳んだ習慣と同じく、その週に記録があるときだけ数える。
   */
  retiredIds?: ReadonlySet<string>;
}

const kept = (state: string): boolean => state === "done" || state === "partial";

/** できばえとして有効な値か。0〜100 の有限な数 */
const validScore = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

/**
 * その週の数字を組み立てる。
 *
 * ■ どの習慣を数えるか（habit-month.ts と同じ）
 * - 進行中: その週の終わりより前に作っていれば数える（記録が無くても）
 * - 畳んだ・完了した目標の習慣: その週に記録があるときだけ数える
 *
 * ■ 率（planned / achieved）
 * - 立ち上がり14日の習慣（isWarmingUp）は入れない。始めた翌週に「30%」を
 *   見せるのは続ける気を削ぐだけで、情報が無い
 * - 日で数える習慣: 予定日が分母。休みは外す。今日の未記録・まだ来ていない日は入れない。
 *   作成日はやった記録があるときだけ。予定外の日の記録は分子に入れない（100%超を防ぐ）
 * - 週N回: 週の目安が分母、分子は目安で頭打ち。作った週と、畳んだ日をまたぐ週は入れない
 *
 * ■ 回数（kept / partial / missed / skipped）
 * 記録そのものの事実なので、立ち上がり中の習慣も数える。
 */
export function buildWeekSummary(
  habits: Habit[],
  logs: HabitLog[],
  boxes: TimeBox[],
  weekStart: string,
  today: string,
  opts: WeekOptions = {},
): WeekSummary {
  const dates = weekDates(weekStart);
  const weekEnd = dates[6];
  const inWeek = (d: string) => d >= weekStart && d <= weekEnd;
  // 率を数えるのは今日まで。立ち上がりの判断も「今日（または週の終わり）」で
  const refEnd = today < weekEnd ? today : weekEnd;

  let habitCount = 0;
  let planned = 0;
  let achieved = 0;
  let done = 0;
  let partial = 0;
  let missed = 0;
  let skipped = 0;
  let keptTotal = 0;
  let extra = 0;
  let warmingUpCount = 0;

  for (const habit of habits) {
    const weekLogs = logs.filter((l) => l.habitId === habit.id && inWeek(l.date));
    const retired = Boolean(habit.archivedAt) || Boolean(opts.retiredIds?.has(habit.id));
    const start = habitStartDate(habit);
    if (retired) {
      if (weekLogs.length === 0) continue;
    } else if (weekLogs.length === 0 && start > weekEnd) {
      continue;
    }
    habitCount++;

    const weekly = countsByWeek(habit);
    for (const l of weekLogs) {
      if (l.state === "done") done++;
      else if (l.state === "partial") partial++;
      else if (l.state === "missed") missed++;
      else if (l.state === "skipped") skipped++;
      if (kept(l.state)) {
        keptTotal++;
        if (!weekly && !isScheduled(habit, l.date)) extra++;
      }
    }

    const warming = isWarmingUp(habit, refEnd);
    if (warming) {
      warmingUpCount++;
      continue;
    }
    const archiveDate = habit.archivedAt ? toLocalDate(new Date(habit.archivedAt)) : null;

    if (weekly) {
      const target = habit.schedule.kind === "timesPerWeek" ? Math.max(1, habit.schedule.times) : 0;
      // 作った週は途中から始まっているので、率に入れない
      if (weekStart <= mondayOf(start)) continue;
      // 畳んだ日をまたぐ週・畳んだあとの週は、約束が終わっているので入れない
      if (archiveDate && weekEnd > archiveDate) continue;
      // まだ始まっていない週は分母にしない
      if (weekStart > today) continue;
      const n = weekLogs.filter((l) => kept(l.state)).length;
      planned += target;
      achieved += Math.min(target, n);
      continue;
    }

    for (const date of dates) {
      if (date > today) break;
      if (date < start) continue;
      if (archiveDate && date > archiveDate) continue;
      if (!isScheduled(habit, date)) continue;
      const log = weekLogs.find((l) => l.date === date);
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
  }

  const scores = boxes
    .filter((b) => inWeek(b.date))
    .map((b) => b.review?.score)
    .filter(validScore);
  const scoreAvg =
    scores.length === 0
      ? null
      : Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  return {
    weekStart,
    phase: weekPhase(weekStart, today),
    habitCount,
    planned,
    achieved,
    rate: planned === 0 ? null : achieved / planned,
    kept: keptTotal,
    done,
    partial,
    missed,
    skipped,
    extra,
    warmingUpCount,
    scoreAvg,
    scoreCount: scores.length,
  };
}

// ------------------------------------------------------------ 一言の保存

/** 1欄の最大文字数。短い一言の欄なので、貼り付けの暴走だけを止める */
export const REVIEW_MAX_LENGTH = 1000;

const clean = (v: unknown): string =>
  typeof v === "string" ? v.trim().slice(0, REVIEW_MAX_LENGTH) : "";

export const reviewOf = (reviews: WeeklyReview[], weekStart: string): WeeklyReview | null =>
  reviews.find((r) => r.weekStart === weekStart) ?? null;

/**
 * 「前回の自分から」。直前の週に書いた「来週の自分へ」。
 * 直前の週に無い・空なら null（もっと前の週のものは出さない。
 * 古い一言を今週の言葉として見せると、書いた当時の文脈とずれる）。
 */
export function previousNote(reviews: WeeklyReview[], weekStart: string): string | null {
  const prev = reviewOf(reviews, shiftWeek(weekStart, -1));
  const note = prev?.nextNote.trim() ?? "";
  return note === "" ? null : note;
}

/**
 * 1週ぶんを書き込んだ新しい配列を返す（元の配列は変えない）。
 * 週で一意（同じ週は上書き）。2欄とも空なら行を消す。空の行は作らない。
 */
export function upsertReview(
  reviews: WeeklyReview[],
  weekStart: string,
  good: string,
  nextNote: string,
  nowIso: string,
): WeeklyReview[] {
  const key = mondayOf(weekStart);
  const rest = reviews.filter((r) => r.weekStart !== key);
  const g = clean(good);
  const n = clean(nextNote);
  if (g === "" && n === "") return rest;
  return [...rest, { weekStart: key, good: g, nextNote: n, updatedAt: nowIso }];
}

/**
 * 保存から読んだ値を、安全な形にそろえる。壊れた行は捨てる。
 * - weekStart が実在する月曜でない行は捨てる（週で一意のキーなので丸めない）
 * - 2欄とも空の行は捨てる
 * - 同じ週が複数あれば updatedAt の新しいほうを残す
 */
export function normalizeReviews(raw: unknown): WeeklyReview[] {
  if (!Array.isArray(raw)) return [];
  const byWeek = new Map<string, WeeklyReview>();
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const weekStart = typeof r.weekStart === "string" ? r.weekStart : "";
    if (!isRealDate(weekStart) || mondayOf(weekStart) !== weekStart) continue;
    const row: WeeklyReview = {
      weekStart,
      good: clean(r.good),
      nextNote: clean(r.nextNote),
      updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
    };
    if (row.good === "" && row.nextNote === "") continue;
    const cur = byWeek.get(weekStart);
    if (!cur || row.updatedAt >= cur.updatedAt) byWeek.set(weekStart, row);
  }
  return [...byWeek.values()];
}
