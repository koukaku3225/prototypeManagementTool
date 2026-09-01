import type { Habit } from "@/types/behavior";
import { emptyMeta, type TimeBox } from "@/types/timebox";
import { DAY_MINUTES, DEFAULT_DURATION, toMinutes, toTime } from "@/lib/timebox";

/**
 * 習慣から、その日の時間割の枠を起こす。
 *
 * 習慣はもともと曜日（schedule）と開始時刻（startTime）を持っているのに、
 * 時間割とは分かれたままだった。そのせいで「毎週やること」まで
 * 毎回手で入れ直すことになり、入力そのものが続かない原因になっていた。
 * 定義した時点で並ぶようにすれば、その手間は丸ごと消える。
 *
 * ■ 実体を作らない
 * 起こした枠は保存しない。保存すると、習慣の時刻を変えたときに
 * 過去に量産した枠が古いまま残るし、先の日付をどこまで作るかの
 * 際限もなくなる。表示するときにその場で計算し、
 * ユーザーが触った枠だけを実体にする（materializeHabitBox）。
 *
 * ■ 週◯回（timesPerWeek）は並べない
 * 曜日を持たないので、置くべき日が決まらない。
 * 習慣のチェックリスト側で扱うほうが正しい。
 */

/** 自動配置できる習慣か。時刻が無い・曜日が決まらないものは置けない */
export function canPlace(habit: Habit): boolean {
  if (habit.archivedAt) return false;
  if (!habit.startTime) return false;
  // 週◯回は「いつやるか」が決まっていないので、時間割には置けない
  return habit.schedule.kind !== "timesPerWeek";
}

/** その日にその習慣を置くか。canPlace を通ったものだけ渡すこと */
export function placedOn(habit: Habit, date: string): boolean {
  const s = habit.schedule;
  if (s.kind === "daily") return true;
  if (s.kind === "weekdays") {
    const dow = new Date(`${date}T00:00:00`).getDay();
    return s.days.includes(dow);
  }
  return false;
}

/**
 * 自動で起こした枠のid。
 * 日付と習慣から決まる固定の値にしておくと、
 * 同じ枠を二度起こしても同じidになり、重複を判定できる。
 */
export const habitBoxId = (habitId: string, date: string): string =>
  `habit-${habitId}-${date}`;

/** 自動で起こした枠か（実体化されていないもの）。id で見分ける */
export const isGhost = (box: TimeBox): boolean => box.id.startsWith("habit-");

/**
 * その日に並べる、習慣由来の枠。
 *
 * すでに実体のある枠（手で触って保存されたもの）とは重複させない。
 * 実体側が正で、そちらがあれば自動配置は引っ込む。
 */
export function habitBoxesOn(
  date: string,
  habits: Habit[],
  existing: TimeBox[],
): TimeBox[] {
  // その習慣の枠が、その日にもう実体として在るか
  const taken = new Set(
    existing.filter((b) => b.habitId && b.date === date).map((b) => b.habitId),
  );

  return habits
    .filter((h) => canPlace(h) && placedOn(h, date) && !taken.has(h.id))
    .map((h) => {
      const startMin = toMinutes(h.startTime as string) ?? 0;
      /*
       * 日をまたぐ枠は作らない。24時で止める。
       *
       * 長さは2段構え。まず「値が無い・壊れている」を既定の30分で拾う
       * （型は number だが、古いスナップショットの読み込み・手編集した
       * JSON・将来の取り込み機能などを経由すると、実行時には無い場合がある。
       * Math.max(15, undefined) は NaN になり、時刻が "NaN:NaN" として
       * 描画されるまで気づけない——実際にレビューのやり直しで見つかった）。
       * そのうえで Math.max(15, ...) を通し、0分のような「値はあるが短すぎる」
       * ものだけを15分下限に丸める。0 を「未設定」と混同しない
       * （`|| 30` に戻すと、それはそれで元の不具合が戻る）。
       */
      const rawEstimate = Number.isFinite(h.estimateMin) ? h.estimateMin : DEFAULT_DURATION;
      const endMin = Math.min(DAY_MINUTES, startMin + Math.max(15, rawEstimate));
      return {
        id: habitBoxId(h.id, date),
        date,
        start: toTime(startMin),
        end: toTime(endMin),
        title: h.title,
        cardId: h.cardId,
        color: null,
        habitId: h.id,
        meta: emptyMeta(),
        completedAt: null,
        review: null,
        createdAt: h.createdAt,
      } satisfies TimeBox;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * 自動配置の枠を、実体のある枠に変える。
 *
 * ユーザーが触った（動かした・完了した・中身を書いた）時点で初めて保存する。
 * id を作り直すのは、以後この枠が習慣の定義から独立して動けるようにするため
 * （時刻を動かしたのに、翌週その変更が消えると意味が分からない）。
 * habitId は残す。どの習慣から来たかは、あとで辿れたほうがよい。
 */
export function materializeHabitBox(ghost: TimeBox, id: string): TimeBox {
  return { ...ghost, id, createdAt: new Date().toISOString() };
}
