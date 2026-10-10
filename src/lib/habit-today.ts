import { computeStats } from "@/lib/habit";
import {
  canPlace,
  habitBoxesOn,
  materializeHabitBox,
  placedOn,
} from "@/lib/habit-plan";
import { emptyReview, type TimeBox } from "@/types/timebox";
import type { Habit, HabitLog, HabitLogState, HabitStats } from "@/types/behavior";

/**
 * 習慣タブ（/habits）の判断。I/O を持たない。
 *
 * ■ 3つに分ける
 *   - open   … 今日やる習慣で、まだ記録が無いもの（画面で大きく出す）
 *   - logged … 今日の記録があるもの（done / partial / missed / skipped すべて）
 *   - off    … 今日は予定のないもの（閉じて出す）
 *
 * どの習慣も必ずどれか1つに入る。「出てこない習慣」が生まれると、
 * 入れ忘れなのか消えたのか区別がつかない。
 */

export interface HabitItem {
  habit: Habit;
  stats: HabitStats;
}

export interface TodaySplit {
  open: HabitItem[];
  logged: HabitItem[];
  off: HabitItem[];
}

export function splitTodayHabits(habits: Habit[], logs: HabitLog[], today: string): TodaySplit {
  const out: TodaySplit = { open: [], logged: [], off: [] };
  for (const habit of habits) {
    if (habit.archivedAt) continue;
    const stats = computeStats(habit, logs, today);
    const item = { habit, stats };
    // 予定のない日に付けた記録は消さずに見せる（押した結果が消えると押したか分からない）
    if (stats.todayLog) out.logged.push(item);
    else if (stats.dueToday) out.open.push(item);
    else out.off.push(item);
  }
  // 時刻の早い順。時刻なしは最後。同じなら作った順
  const key = (x: HabitItem) => x.habit.startTime ?? "99:99";
  out.open.sort((a, b) => key(a).localeCompare(key(b)) || a.habit.createdAt.localeCompare(b.habit.createdAt));
  return out;
}

/** logHabitState が使う外部依存。テストでは差し替える */
export interface HabitLogDeps {
  upsertTimeBox: (b: TimeBox) => unknown;
  setHabitLog: (l: HabitLog) => unknown;
  newId: () => string;
  now: () => string;
}

/**
 * 今日の記録を書く。
 *
 * 時刻つきの習慣（canPlace）は時間割の枠としても並ぶので、記録だけ書くと
 * 「習慣は済んだのに枠は未完了」とずれる。時間割・今日の画面と同じく、
 * 完了は枠を通して書く（plan/list の save と同じ約束）。
 *
 *   - done / partial … 枠を実体にして完了し、習慣の記録を同じ時刻で付ける。
 *     同じ時刻にしておくのは、枠の完了取消が「時刻の一致する記録だけ」を
 *     取り消すため（storage の clearHabitLogFromBox）。
 *   - missed / skipped … 枠は新しく作らない。完了済みの枠があれば完了を外す。
 *   - すでに完了した枠は完了時刻を変えない（メモの追記で時刻が動かないように）。
 */
export function logHabitState(args: {
  habit: Habit;
  state: HabitLogState;
  note: string | null;
  date: string;
  /** 実体のある枠（非表示を除く全件でよい） */
  existing: TimeBox[];
  deps: HabitLogDeps;
}): void {
  const { habit, state, note, date, existing, deps } = args;
  const now = deps.now();
  const placed = canPlace(habit) && placedOn(habit, date);
  const real = existing.find((b) => b.habitId === habit.id && b.date === date);
  let at = now;

  if (placed) {
    if (state === "done" || state === "partial") {
      const base =
        real ??
        (() => {
          const ghost = habitBoxesOn(date, [habit], existing)[0];
          return ghost ? materializeHabitBox(ghost, deps.newId()) : null;
        })();
      if (base) {
        if (base.completedAt) {
          at = base.completedAt;
        } else {
          deps.upsertTimeBox({ ...base, completedAt: now, review: base.review ?? emptyReview() });
        }
      }
    } else if (real?.completedAt) {
      deps.upsertTimeBox({ ...real, completedAt: null });
    }
  }

  deps.setHabitLog({ habitId: habit.id, date, state, at, note, mood: null });
}

/**
 * 押した瞬間に出す短い言葉。責める言葉は持たない。
 * できなかった・休みは何も出さない（祝う場面ではない）。
 */
export function cheerFor(
  state: HabitLogState,
  stats: Pick<HabitStats, "streak" | "unit">,
): string | null {
  const n = stats.streak;
  const unit = stats.unit === "week" ? "週" : "日";
  if (state === "done") {
    if (n <= 1) return "やった！ 今日がはじめの1回";
    return stats.unit === "week" ? `やった！ ${n}週続いています` : `やった！ ${n}日連続`;
  }
  if (state === "partial") return `最小版でも続いています（${n}${unit}連続）`;
  return null;
}
