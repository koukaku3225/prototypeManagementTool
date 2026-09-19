import { addDays, diffDays, startOfWeek, today, toLocalDate } from "@/lib/date";
import { countsAsPlanned, durationMin } from "@/lib/timebox";
import type {
  Checkpoint,
  CheckpointEvaluation,
  CheckpointMeasure,
  CheckpointPeriodKind,
} from "@/types/goal";
import type { TimeBox } from "@/types/timebox";

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
 *
 * active最優先。その中では**まだ期間が残っているもの**を先に見て、期限が近い順。
 * 期間が残っているものが1つも無ければ、いちばん最近終わったものを返す。1件もなければ null。
 *
 * 期間の残りを見ずに「期限が近い順」だけで選ぶと、閉じ忘れた先週の中間目標が
 * 永遠に先頭に居座り、目標の一覧（/goals・/tree）で今週の中間目標が隠れる。
 * 受け取った now を使っていなかったのが原因（2026-09-20 に実機で確認）。
 */
export function nearestActive(list: Checkpoint[], now: string = today()): Checkpoint | null {
  const active = list.filter((c) => c.status === "active");
  if (active.length === 0) return null;
  const live = active.filter((c) => !isPeriodOver(c, now));
  if (live.length > 0) {
    return [...live].sort((a, b) => a.period.end.localeCompare(b.period.end))[0];
  }
  return [...active].sort((a, b) => b.period.end.localeCompare(a.period.end))[0];
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

// ---------------------------------------------------------------- 進み具合と引き継ぎ（中間目標タブ）

export const measureOf = (c: Pick<Checkpoint, "measure">): CheckpointMeasure => c.measure ?? "done";

export interface CheckpointProgress {
  measure: CheckpointMeasure;
  /** time は予定の合計時間（時間）、count は回数、done は 0/1 */
  value: number;
  /** time のうち完了した時間。それ以外は value と同じ */
  doneValue: number;
  /** 目安。done と、目安が無いときは null */
  target: number | null;
  /** 0〜1。目安が無ければ done 以外は 0 */
  ratio: number;
  met: boolean;
}

/**
 * 中間目標の数に入れてよい予定か。
 *
 * 非表示（アプリで消した取り込み枠）は最初から見えないので数えない。
 * Google 側で消された予定の扱いは時間割の合計とそろえる（`countsAsPlanned`）。
 */
export const countsForCheckpoint = (
  b: Pick<TimeBox, "hiddenAt" | "sourceGoneAt" | "completedAt">,
): boolean => !b.hiddenAt && countsAsPlanned(b);

/**
 * 中間目標の進み具合。
 *
 * 紐づけた予定のうち、数に入れてよく（countsForCheckpoint）、
 * 日付が期間内のものだけを数える。
 * 時間は「予定を入れた時点」で数える（竜一の選択、2026-09-17）。
 * 確保した時間が見えることを優先し、実際にやった時間は doneValue で添える。
 */
export function checkpointProgress(
  c: Checkpoint,
  boxes: readonly TimeBox[],
): CheckpointProgress {
  const measure = measureOf(c);
  if (measure === "done") {
    const met = c.status === "done";
    return { measure, value: met ? 1 : 0, doneValue: met ? 1 : 0, target: null, ratio: met ? 1 : 0, met };
  }
  const linked = boxes.filter(
    (b) =>
      b.checkpointId === c.id &&
      countsForCheckpoint(b) &&
      b.date >= c.period.start &&
      b.date <= c.period.end,
  );
  let value: number;
  let doneValue: number;
  if (measure === "time") {
    value = linked.reduce((s, b) => s + durationMin(b), 0) / 60;
    doneValue = linked.filter((b) => b.completedAt).reduce((s, b) => s + durationMin(b), 0) / 60;
  } else {
    value = linked.filter((b) => b.completedAt).length + (c.manualCount ?? 0);
    doneValue = value;
  }
  const target = c.target && c.target > 0 ? c.target : null;
  const ratio = target ? Math.min(1, value / target) : 0;
  return { measure, value, doneValue, target, ratio, met: target !== null && value >= target };
}

/** 手で足した回数を増減する。押し間違いを戻せるように。手で足したぶんより下げない */
export function withManualCountDelta(c: Checkpoint, delta: number): Checkpoint {
  return { ...c, manualCount: Math.max(0, (c.manualCount ?? 0) + delta) };
}

/** 予定の日付が中間目標の期間に入っているか。外なら紐づけても数えない */
export const boxInPeriod = (c: Pick<Checkpoint, "period">, box: Pick<TimeBox, "date">): boolean =>
  c.period.start <= box.date && box.date <= c.period.end;

/** 期間の見せ方。週は「9/7〜9/13」、月は「2026年8月」 */
export function periodLabel(p: Checkpoint["period"]): string {
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  if (p.kind === "month") return `${p.start.slice(0, 4)}年${Number(p.start.slice(5, 7))}月`;
  return `${md(p.start)}〜${md(p.end)}`;
}

/** 数の見せ方。時間は小数1桁（整数ならそのまま）、回数は整数 */
export function formatProgressValue(measure: CheckpointMeasure, v: number): string {
  if (measure !== "time") return String(Math.round(v));
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * 入力欄の目安を数にする。正しくなければ null。
 * `Number("")` は 0 なので、空欄を「0時間」と読まないよう先に弾く。回数は整数だけ
 */
export function parseCheckpointTarget(measure: CheckpointMeasure, raw: string): number | null {
  if (measure === "done" || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (measure === "count" && !Number.isInteger(n)) return null;
  return n;
}

/**
 * 振り返りの1件が選び終わっているか。
 * 「目安を変えて続ける」で数が正しくないのに始められると、黙って同じ目安で続いてしまう
 */
export function reviewPickReady(
  c: Pick<Checkpoint, "measure">,
  pick: "same" | "change" | "end" | undefined,
  rawTarget: string | undefined,
): boolean {
  if (!pick) return false;
  if (pick !== "change") return true;
  return parseCheckpointTarget(measureOf(c), rawTarget ?? "") !== null;
}

/** 今日の画面に添える進み具合。「5.5 / 10時間」「2 / 3回」。達成は数が無いので null */
export function progressSummary(c: Checkpoint, boxes: readonly TimeBox[]): string | null {
  const p = checkpointProgress(c, boxes);
  if (p.measure === "done") return null;
  const unit = p.measure === "time" ? "時間" : "回";
  const v = formatProgressValue(p.measure, p.value);
  return p.target === null ? `${v}${unit}` : `${v} / ${formatProgressValue(p.measure, p.target)}${unit}`;
}

/**
 * 測り方と目安を変える（目標の詳細の編集欄）。
 * 時間・回数で目安が正しくないときは変えない。入力途中の空欄で「目安なし」を保存しない
 */
export function withMeasure(c: Checkpoint, measure: CheckpointMeasure, target: number | null): Checkpoint {
  if (measure === "done") return { ...c, measure, target: null };
  if (target === null) return c;
  return { ...c, measure, target };
}

/**
 * 今の期間の中間目標。期間が今日を含み、生きている目標にぶら下がる。
 * できた（done）も残す。チェックした「達成」が消えると、取り消せず、できたことも見えなくなる。
 * 終わりにした（abandoned）は出さない。
 */
export function currentCheckpoints(
  list: readonly Checkpoint[],
  liveCardIds: readonly string[],
  now: string = today(),
): Checkpoint[] {
  const live = new Set(liveCardIds);
  return list.filter(
    (c) =>
      c.status !== "abandoned" && live.has(c.cardId) && c.period.start <= now && now <= c.period.end,
  );
}

/** 振り返り待ち。活動中のまま期間が終わったもの */
export function pendingReviews(
  list: readonly Checkpoint[],
  liveCardIds: readonly string[],
  now: string = today(),
): Checkpoint[] {
  const live = new Set(liveCardIds);
  return list
    .filter((c) => c.status === "active" && live.has(c.cardId) && isPeriodOver(c, now))
    .sort((a, b) => a.period.end.localeCompare(b.period.end));
}

export type CarryOverChoice = { kind: "same" } | { kind: "change"; target: number } | { kind: "end" };

/**
 * 期間が終わった中間目標を閉じ、続けるなら今の期間で新しく作る。
 *
 * 閉じるときの status は結果で決める（達成 → done、未達 → abandoned）。
 * abandoned は既存の「今回は終わりにする」で、失敗ではない（goal.ts の CheckpointStatus 参照）。
 * 手で足した回数は新しい期間に持ち越さない。
 */
export function closeAndCarryOver(
  c: Checkpoint,
  boxes: readonly TimeBox[],
  choice: CarryOverChoice,
  now: Date = new Date(),
  /** 既にある中間目標。今の期間に同じものがあれば作らない（手で先に足していた場合） */
  existing: readonly Checkpoint[] = [],
): { closed: Checkpoint; next: Checkpoint | null } {
  const at = now.toISOString();
  const { met } = checkpointProgress(c, boxes);
  const closed: Checkpoint = { ...c, status: met ? "done" : "abandoned", updatedAt: at };
  if (choice.kind === "end") return { closed, next: null };
  const period = { kind: c.period.kind, ...defaultPeriod(c.period.kind, now) };
  const dup = existing.find(
    (x) =>
      x.id !== c.id &&
      // 終わりにしたものは一覧に出ない。それを「もうある」と数えると、選んでも何も起きない
      x.status !== "abandoned" &&
      x.cardId === c.cardId &&
      x.title.trim() === c.title.trim() &&
      x.period.kind === period.kind &&
      x.period.start === period.start,
  );
  if (dup) {
    // 目安を変えるなら既にあるほうを変える。選んだのに何も起きない、にしない
    return {
      closed,
      next: choice.kind === "change" ? { ...dup, target: choice.target, updatedAt: at } : null,
    };
  }
  const next: Checkpoint = {
    id: crypto.randomUUID(),
    cardId: c.cardId,
    title: c.title,
    period,
    status: "active",
    measure: measureOf(c),
    target: choice.kind === "change" ? choice.target : (c.target ?? null),
    manualCount: 0,
    previousId: c.id,
    createdAt: at,
    updatedAt: at,
  };
  return { closed, next };
}

/**
 * 予定シートの「どの中間目標か」に並べるもの。
 * 予定の目標にぶら下がり、予定の日付を期間に含む活動中のもの。
 * 今選んでいるものは、条件から外れていても残す（黙って外れて見えないように）。
 */
export function checkpointOptionsForBox(
  list: readonly Checkpoint[],
  box: Pick<TimeBox, "cardId" | "date" | "checkpointId">,
): Checkpoint[] {
  const out = box.cardId
    ? list.filter(
        (c) =>
          c.cardId === box.cardId &&
          c.status === "active" &&
          c.period.start <= box.date &&
          box.date <= c.period.end,
      )
    : [];
  if (box.checkpointId && !out.some((c) => c.id === box.checkpointId)) {
    const cur = list.find((c) => c.id === box.checkpointId);
    if (cur) out.push(cur);
  }
  return out;
}

/**
 * `/plan?checkpoint=<id>` で渡された中間目標。
 * 実在しない・閉じた・目標が完了した中間目標は無視する（古いリンクを踏むことがある）。
 */
export function presetCheckpointFrom(
  search: string,
  list: readonly Checkpoint[],
  cards: readonly { id: string; status?: string }[],
): Checkpoint | null {
  let id: string | null = null;
  try {
    id = new URLSearchParams(search).get("checkpoint");
  } catch {
    return null;
  }
  if (!id) return null;
  const cp = list.find((c) => c.id === id);
  if (!cp || cp.status !== "active") return null;
  const card = cards.find((c) => c.id === cp.cardId);
  if (!card || (card.status ?? "active") === "done") return null;
  return cp;
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
