/**
 * 時間割の「押して離した」を、どう解釈するかの判断だけを切り出したもの。
 *
 * ここを useGridDrag の中に埋め込んでいたせいで、スマホの実機でしか
 * 確かめられず、次の壊れ方に気づけなかった:
 *
 *   枠を 250ms ほど押して離す（指では普通のタップ）と長押しが成立し、
 *   「つかんだ」扱いになる。動かしていないので何も変わらないのに、
 *   直後の click は「ドラッグ直後」として捨てられ、**予定が開かない**。
 *   本人からは「タップしても反応しない」に見える。
 *
 * 押していた時間と、実際に動いたかどうかで意味を決める。純粋関数なので
 * tests/grid-gesture.test.mjs が全通りを固定できる。
 */

export type GestureKind = "move" | "resize-start" | "resize-end" | "create";

/**
 * 押して離した結果。
 *
 *   commit … 動かしたので、その位置・長さで確定する
 *   tap    … 動かしていない短い押し。ふつうのタップとして扱う（予定を開く）
 *   hold   … 動かしていない長い押し。選んだ状態だけ残す（続けてつまみを引く）
 */
export type PressOutcome = "commit" | "tap" | "hold";

/**
 * これより短い押しは、長押しではなく「タップのつもり」とみなす。
 *
 * 長押しの成立は 220ms。指のタップは 100〜300ms に散らばるので、
 * 成立直後の帯（220〜500ms）は「つかむつもりだった」と断定できない。
 * 迷う帯では、失うものが無いほう（予定を開く）に倒す。
 */
export const TAP_MAX_MS = 500;

export function pressOutcome(i: {
  kind: GestureKind;
  /** 押してから離すまでに、実際に動かしたか */
  moved: boolean;
  /** 押していた時間（ミリ秒） */
  heldMs: number;
}): PressOutcome {
  if (i.moved) return "commit";
  // 空きを引いて作る操作は、動かしていなければ何も作らない。
  // 続けて飛んでくる click が既定の長さの枠を作る（＝タップと同じ扱い）
  if (i.kind === "create") return "tap";
  return i.heldMs < TAP_MAX_MS ? "tap" : "hold";
}

/**
 * 指のぶれを「動かした」と数えない距離（px）。
 *
 * 触る操作では、押さえている間に数pxは必ず動く。1pxでも動いた扱いにすると、
 * 同じ場所に置き直す保存が走り、そのうえ直後の click が捨てられて
 * 予定が開かなくなる。
 */
export const MOVE_SLOP_PX = 4;

/** ドラッグが始まったあと、この距離を超えて初めて「動かした」とみなす */
export function isRealMove(dy: number): boolean {
  return Math.abs(dy) > MOVE_SLOP_PX;
}
