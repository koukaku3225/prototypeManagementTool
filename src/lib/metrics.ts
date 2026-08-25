import {
  PHASE_ORDER,
  type AnyPhaseId,
  type GoalCard,
  type PhaseId,
  type Session,
  type TokenUsage,
} from "@/types/goal";
import { usdOf, usdWithoutCache, yenOf } from "@/lib/pricing";

/** M8: セッション1本ぶんのトークンとコスト */
export interface CostMetrics {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 入力のうちキャッシュから読めた割合。施策の効き目はここに出る */
  cacheHitRate: number;
  usd: number;
  yen: number;
  /** キャッシュがまったく効かなかった場合の USD。比較用 */
  usdWithoutCache: number;
}

export function computeCost(usage: TokenUsage[] | undefined): CostMetrics {
  const rows = usage ?? [];
  const sum = (f: (u: TokenUsage) => number) =>
    rows.reduce((n, u) => n + f(u), 0);

  const input = sum((u) => u.input);
  const cacheRead = sum((u) => u.cacheRead);
  const cacheWrite = sum((u) => u.cacheWrite);
  const totalInput = input + cacheRead + cacheWrite;
  const usd = rows.reduce((n, u) => n + usdOf(u), 0);

  return {
    calls: rows.length,
    input,
    output: sum((u) => u.output),
    cacheRead,
    cacheWrite,
    cacheHitRate: totalInput ? cacheRead / totalInput : 0,
    usd,
    yen: yenOf(usd),
    usdWithoutCache: rows.reduce((n, u) => n + usdWithoutCache(u), 0),
  };
}

export interface SessionMetrics {
  sessionId: string;
  variant: Session["variant"];
  /** M1: 完走したか */
  completed: boolean;
  /** M2: 中断した場合、どのフェーズで離脱したか */
  droppedAtPhase: AnyPhaseId | null;
  /** M3: フェーズ2の滞在時間（分） */
  meaningMinutes: number | null;
  /** M4: フェーズ2でのユーザー回答の平均文字数 */
  meaningAvgChars: number | null;
  /** H4: ロック中の打鍵挙動 */
  draft: {
    locks: number;
    avgCharsTyped: number;
    avgCharsDeleted: number;
    avgFirstKeystrokeMs: number | null;
  };
  totalTurns: number;
  totalMinutes: number | null;
  /** M8: トークンとコスト */
  cost: CostMetrics;
}

export function computeSessionMetrics(s: Session): SessionMetrics {
  const userMsgs = s.messages.filter((m) => m.role === "user");
  const meaningUser = userMsgs.filter((m) => m.phase === "meaning");

  const drafts = userMsgs
    .map((m) => m.draftEvents)
    .filter((d): d is NonNullable<typeof d> => Boolean(d));

  const firstKeystrokes = drafts
    .map((d) => d.firstKeystrokeAtMs)
    .filter((v): v is number => v !== null);

  return {
    sessionId: s.id,
    variant: s.variant,
    completed: Boolean(s.completedAt),
    droppedAtPhase: s.completedAt ? null : s.currentPhase,
    meaningMinutes: phaseMinutes(s, "meaning"),
    meaningAvgChars: meaningUser.length
      ? Math.round(
          meaningUser.reduce((n, m) => n + m.content.length, 0) /
            meaningUser.length,
        )
      : null,
    draft: {
      locks: drafts.length,
      avgCharsTyped: avg(drafts.map((d) => d.charsTyped)),
      avgCharsDeleted: avg(drafts.map((d) => d.charsDeleted)),
      avgFirstKeystrokeMs: firstKeystrokes.length
        ? avg(firstKeystrokes)
        : null,
    },
    totalTurns: userMsgs.length,
    totalMinutes: s.completedAt
      ? minutesBetween(s.startedAt, s.completedAt)
      : null,
    cost: computeCost(s.usage),
  };
}

/** フェーズの滞在時間。次フェーズの開始時刻（なければ最終発言）との差分。 */
function phaseMinutes(s: Session, phase: PhaseId): number | null {
  const start = s.phaseEnteredAt[phase];
  if (!start) return null;

  const idx = PHASE_ORDER.indexOf(phase);
  for (let i = idx + 1; i < PHASE_ORDER.length; i++) {
    const next = s.phaseEnteredAt[PHASE_ORDER[i]];
    if (next) return minutesBetween(start, next);
  }
  const last = s.messages.at(-1)?.timestamp ?? s.completedAt;
  return last ? minutesBetween(start, last) : null;
}

function minutesBetween(a: string, b: string): number {
  return Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 60_000) * 10) / 10;
}

function avg(ns: number[]): number {
  if (!ns.length) return 0;
  return Math.round(ns.reduce((a, b) => a + b, 0) / ns.length);
}

/** M5: 目標カードのどの項目が編集されたか */
export function editedFieldRate(card: GoalCard | null): {
  count: number;
  fields: string[];
} {
  if (!card) return { count: 0, fields: [] };
  return { count: card.editedFields.length, fields: card.editedFields };
}
