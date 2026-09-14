import { addDays, diffDays, startOfWeek, today, toLocalDate } from "@/lib/date";
import type { Checkpoint, CheckpointEvaluation, CheckpointPeriodKind } from "@/types/goal";

/**
 * 中間目標（週/月）の計算。
 *
 * 期間の境界とストリークの数え方は目で見て正しさが分からないので、
 * habit.ts と同じ方針でぜんぶ純粋関数にし、tests/checkpoint.test.mjs で固定する。
 */

/** その種類の、いまを含む期間の既定値。作成時にここから始めて、必要なら手で直す */
export function defaultPeriod(
  kind: CheckpointPeriodKind,
  from: Date = new Date(),
): { start: string; end: string } {
  if (kind === "week") {
    const start = startOfWeek(from);
    return { start, end: addDays(6, new Date(`${start}T00:00:00`)) };
  }
  // 月:その月の1日〜末日。翌月1日の前日を末日として求める（月末日数を数え間違えない）
  const y = from.getFullYear();
  const m = from.getMonth();
  const start = toLocalDate(new Date(y, m, 1));
  const end = toLocalDate(new Date(y, m + 1, 0));
  return { start, end };
}

/** 期間の終わりまでの残り日数。今日を含む。期間が終わっていれば0 */
export function daysLeft(c: Pick<Checkpoint, "period">, now: string = today()): number {
  if (now > c.period.end) return 0;
  return diffDays(now, c.period.end) + 1;
}

/** 期間の総日数（両端含む） */
export function totalDays(c: Pick<Checkpoint, "period">): number {
  return diffDays(c.period.start, c.period.end) + 1;
}

/** 期間が終わっているか（statusに関係なく、期日だけで判定） */
export function isPeriodOver(c: Pick<Checkpoint, "period">, now: string = today()): boolean {
  return now > c.period.end;
}

/**
 * 進んだ割合（0〜1）。経過日数ベース。
 * 「達成率」ではなく「期間の消化率」。中身の達成度は本人がstatusで申告する。
 */
export function elapsedRatio(c: Pick<Checkpoint, "period">, now: string = today()): number {
  const total = totalDays(c);
  if (total <= 0) return 1;
  const elapsed = Math.min(total, Math.max(0, diffDays(c.period.start, now) + 1));
  return elapsed / total;
}

/**
 * 一覧に出す「いちばん今見るべき」1件。
 * active最優先、その中では期限が近い順。1件もなければ null
 */
export function nearestActive(list: Checkpoint[], now: string = today()): Checkpoint | null {
  const active = list.filter((c) => c.status === "active");
  if (active.length === 0) return null;
  return [...active].sort((a, b) => a.period.end.localeCompare(b.period.end))[0];
}

export interface TodayCheckpoint {
  checkpoint: Checkpoint;
  /** 期間が過ぎたのに、完了にも「今回は終わり」にもしていない */
  over: boolean;
  /** 残り日数（今日を含む）。期限切れなら0 */
  left: number;
}

/**
 * 今日の画面の先頭に出す中間目標（R19、2026-09-14）。
 *
 * 中間目標は目標の詳細にしか出ておらず、「今なにをやるべきか迷わない」という
 * 謳い文句に反して、日々の画面からは見えなかった。
 *
 * - 出すのは、活動中で、見出しがあり、生きている目標（liveCardIds）にぶら下がり、
 *   期間が始まっているもの
 * - 期間が過ぎたのに閉じていないものは先に出す。放っておくと「残り0日」のまま
 *   ずっと残るので、振り返りを促す
 * - その次は期限の近い順。期限が同じなら週を月より先（より手前の区切り）
 * - 画面を占領しないよう max 件まで。残りは件数だけ返す
 */
export function todayCheckpoints(
  list: Checkpoint[],
  liveCardIds: readonly string[],
  now: string = today(),
  max = 2,
): { shown: TodayCheckpoint[]; rest: number } {
  const live = new Set(liveCardIds);
  const eligible = list
    .filter(
      (c) =>
        c.status === "active" &&
        live.has(c.cardId) &&
        c.title.trim().length > 0 &&
        c.period.start <= now,
    )
    .map((c) => ({ checkpoint: c, over: isPeriodOver(c, now), left: daysLeft(c, now) }))
    .sort((a, b) => {
      if (a.over !== b.over) return a.over ? -1 : 1;
      const byEnd = a.checkpoint.period.end.localeCompare(b.checkpoint.period.end);
      if (byEnd !== 0) return byEnd;
      if (a.checkpoint.period.kind === b.checkpoint.period.kind) return 0;
      return a.checkpoint.period.kind === "week" ? -1 : 1;
    });
  return { shown: eligible.slice(0, max), rest: Math.max(0, eligible.length - max) };
}

export function emptyCheckpoint(cardId: string, kind: CheckpointPeriodKind = "week"): Checkpoint {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    cardId,
    title: "",
    period: { kind, ...defaultPeriod(kind) },
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------- 建て方の評価

/**
 * セルフコンコーダンススコア。プラスが多いほど、外部の理由より
 * 自分の内側から来ている目標だと言える（Sheldon & Elliotのモデルに基づく）。
 */
export function selfConcordanceScore(m: CheckpointEvaluation["motives"]): number {
  return m.identified + m.intrinsic - (m.introjected + m.external);
}

export type ScoreTone = "good" | "neutral" | "warn";

/**
 * スコアの言い方。責めない文言にする（達成率を追い詰めない、という既存方針）。
 * ±6 を境目にしているのは、4問中2問が中立(5)から2段階（±2）動けば
 * 届く値で、「なんとなく偏っている」を拾うにはこのくらいがちょうどよいため。
 */
export function scoreTone(score: number): { text: string; tone: ScoreTone } {
  if (score >= 6) return { text: "自分の内側から来ている目標", tone: "good" };
  if (score <= -6) return { text: "外側の理由が強めの目標", tone: "warn" };
  return { text: "半々くらいの目標", tone: "neutral" };
}

/** 動機の4問のうち、どれか1つでも中立(5)から動いているか */
function motivesTouched(m: CheckpointEvaluation["motives"]): boolean {
  return m.identified !== 5 || m.intrinsic !== 5 || m.introjected !== 5 || m.external !== 5;
}

/** 評価パネルを一度でも触ったか。要約を出すかどうかの判定に使う */
export function isEvaluated(e: CheckpointEvaluation | null | undefined): e is CheckpointEvaluation {
  if (!e) return false;
  return motivesTouched(e.motives) || e.linkedValues.length > 0 || e.hasBuddy || Boolean(e.whyItMatters);
}

/** 畳んだ見出しに出す1行要約。触っていない項目は言わない */
export function evaluationSummary(e: CheckpointEvaluation): string {
  const parts: string[] = [];
  if (motivesTouched(e.motives)) {
    const score = selfConcordanceScore(e.motives);
    parts.push(`動機${score >= 0 ? "+" : ""}${score}`);
  }
  if (e.linkedValues.length > 0) parts.push(`価値観${e.linkedValues.length}件`);
  if (e.hasBuddy) parts.push("仲間あり");
  return parts.join("・");
}
