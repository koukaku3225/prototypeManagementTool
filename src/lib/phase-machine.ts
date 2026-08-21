import {
  PHASE_ORDER,
  PHASE_TURN_LIMIT,
  PHASE_TURN_MIN,
  type PhaseId,
} from "@/types/goal";

export const PHASE_TOKEN_RE = /<<<PHASE:([a-z_]+)>>>/;

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

export function isValidPhase(v: string | null): v is PhaseId {
  return v !== null && (PHASE_ORDER as readonly string[]).includes(v);
}

export function nextPhase(current: PhaseId): PhaseId | "done" {
  const i = PHASE_ORDER.indexOf(current);
  return i === PHASE_ORDER.length - 1 ? "done" : PHASE_ORDER[i + 1];
}

/**
 * モデルの申告・最低ターン数・上限ターン数を突き合わせて、実際の次フェーズを決める。
 * モデルが早すぎる遷移を申告しても最低ターン数までは留め、
 * 逆に堂々巡りしていれば上限で強制的に進める。
 */
export function resolvePhase(args: {
  current: PhaseId;
  claimed: string | null;
  turnsInPhase: number;
}): { phase: PhaseId | "done"; forced: boolean } {
  const { current, claimed, turnsInPhase } = args;

  if (turnsInPhase >= PHASE_TURN_LIMIT[current]) {
    return { phase: nextPhase(current), forced: true };
  }

  // モデルが前のフェーズに戻そうとしても従わない。進むか留まるかだけ。
  const currentIndex = PHASE_ORDER.indexOf(current);
  const wantsAdvance =
    claimed === "done" ||
    (isValidPhase(claimed) && PHASE_ORDER.indexOf(claimed) > currentIndex);

  // 2つ以上先を申告されても1つずつしか進めない。
  // meaning / reframe を飛ばされるとこのアプリの価値が消えるため。
  if (wantsAdvance && turnsInPhase >= PHASE_TURN_MIN[current]) {
    return { phase: nextPhase(current), forced: false };
  }

  return { phase: current, forced: false };
}
