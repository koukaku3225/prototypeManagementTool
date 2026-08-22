import {
  FLOW,
  PHASE_TURN_LIMIT,
  PHASE_TURN_MIN,
  BIG_PHASE_TURN_LIMIT,
  BIG_PHASE_TURN_MIN,
  type AnyPhaseId,
  type PhaseStatus,
  type Session,
  type StoryMode,
} from "@/types/goal";

/**
 * 数字も許容する。モデルが `step1` のような想定外のIDを書いたとき、
 * マッチしないと制御トークンがそのまま本文に漏れて画面に出てしまうため。
 * 未知のIDは isValidPhase 側で弾かれるので、広く拾って捨てる方が安全。
 */
export const PHASE_TOKEN_RE = /<<<PHASE:([a-z0-9_]+)>>>/;

/** ストリーミング中に制御トークンを取り除くためのバッファ。 */
export class PhaseTokenFilter {
  private buffer = "";
  private detected: string | null = null;

  /** 表示してよい分だけを返す。トークンの断片は次のチャンクまで保持する。 */
  push(chunk: string): string {
    this.buffer += chunk;

    const m = this.buffer.match(PHASE_TOKEN_RE);
    if (m) {
      this.detected = m[1];
      const before = this.buffer.slice(0, m.index);
      this.buffer = this.buffer.slice((m.index ?? 0) + m[0].length);
      return before;
    }

    // トークンの途中である可能性がある末尾は保持しておく
    const keep = partialTokenTailLength(this.buffer);
    const out = this.buffer.slice(0, this.buffer.length - keep);
    this.buffer = this.buffer.slice(this.buffer.length - keep);
    return out;
  }

  /** ストリーム終了時に残りを吐き出す */
  flush(): string {
    const rest = this.buffer;
    this.buffer = "";
    return rest;
  }

  get phase(): string | null {
    return this.detected;
  }
}

/** 末尾が "<<<PHASE:" の途中になっている長さを返す */
function partialTokenTailLength(s: string): number {
  const marker = "<<<PHASE:";
  const max = Math.min(s.length, marker.length + 20);
  for (let n = max; n > 0; n--) {
    const tail = s.slice(s.length - n);
    if (marker.startsWith(tail)) return n;
    if (tail.startsWith(marker)) return n; // "<<<PHASE:mea" のように途中まで来ている
  }
  return 0;
}

export function isValidPhase(mode: StoryMode, v: string | null): v is AnyPhaseId {
  return v !== null && (FLOW[mode] as readonly string[]).includes(v);
}

export function nextPhase(mode: StoryMode, current: AnyPhaseId): AnyPhaseId | "done" {
  const order = FLOW[mode];
  const i = order.indexOf(current);
  return i === -1 || i === order.length - 1 ? "done" : order[i + 1];
}

function turnMin(mode: StoryMode, phase: AnyPhaseId): number {
  return mode === "big" ? BIG_PHASE_TURN_MIN[phase as never] : PHASE_TURN_MIN[phase as never];
}
function turnLimit(mode: StoryMode, phase: AnyPhaseId): number {
  return mode === "big" ? BIG_PHASE_TURN_LIMIT[phase as never] : PHASE_TURN_LIMIT[phase as never];
}

export function resolvePhase(args: {
  mode: StoryMode;
  current: AnyPhaseId;
  claimed: string | null;
  turnsInPhase: number;
}): { phase: AnyPhaseId | "done"; forced: boolean } {
  const { mode, current, claimed, turnsInPhase } = args;
  const order = FLOW[mode];

  if (turnsInPhase >= turnLimit(mode, current)) {
    return { phase: nextPhase(mode, current), forced: true };
  }

  const currentIndex = order.indexOf(current);
  const wantsAdvance =
    claimed === "done" ||
    (isValidPhase(mode, claimed) && order.indexOf(claimed as AnyPhaseId) > currentIndex);

  if (wantsAdvance && turnsInPhase >= turnMin(mode, current)) {
    return { phase: nextPhase(mode, current), forced: false };
  }

  return { phase: current, forced: false };
}

/**
 * 過去フェーズの回答が編集されたとき、それより後続のフェーズと
 * メッセージを「やり直し」状態にする。削除はしない（監査ログとして残す）。
 */
export function invalidateFrom(session: Session, fromPhase: AnyPhaseId): Session {
  const order = FLOW[session.mode];
  const fromIndex = order.indexOf(fromPhase);
  if (fromIndex === -1) return session;

  const laterPhases = new Set(order.slice(fromIndex + 1));

  const phaseStatus = { ...session.phaseStatus };
  for (const p of laterPhases) phaseStatus[p] = "stale";
  phaseStatus[fromPhase] = "current";

  const phaseTurnCounts = { ...session.phaseTurnCounts };
  for (const p of laterPhases) phaseTurnCounts[p] = 0;

  const messages = session.messages.map((m) =>
    laterPhases.has(m.phase) ? { ...m, invalidated: true } : m,
  );

  return { ...session, currentPhase: fromPhase, phaseStatus, phaseTurnCounts, messages };
}
