import { nextPhase } from "@/lib/phase-machine";
import type { AnyPhaseId, ChatMessage, StoryMode } from "@/types/goal";

/**
 * 対話画面で、ユーザーが流れに割り込むための2つのボタンの判定（R10、2026-09-14）。
 *
 * - 別の質問にする … 「なぜ？」を重ねて「したいから！」に行き着いたような、
 *   答えようのない質問を、答えずに切り替えてもらう
 * - 切り上げて次へ … 上限まで話さずにステップを終える（非推奨の逃げ道）
 *
 * useConversation の状態から切り離して純粋関数にしてあるのは、
 * 応答の途中に押せる・押すほど上限が近づく、のような壊れ方が
 * 画面で見ても気づきにくいため（tests/conversation-controls.test.mjs）。
 */

/** 画面に出す「別の質問にしてください」の発言。会話ログにも残る */
export const REPHRASE_USER_TEXT = "（この質問は置いておいて、別の角度から聞いてください）";

export const isRephraseMessage = (content: string): boolean =>
  content === REPHRASE_USER_TEXT;

export interface ControlView {
  status: "idle" | "streaming" | "error" | "done";
  pendingPhase: AnyPhaseId | "done" | null;
  completedAt: string | null;
  messages: Pick<ChatMessage, "role" | "invalidated">[];
}

/** コーチが問いを出して、ユーザーの返事を待っているときだけ押せる */
export function canRephrase(v: ControlView): boolean {
  if (v.status !== "idle" || v.completedAt) return false;
  const live = v.messages.filter((m) => !m.invalidated);
  return live.length > 0 && live[live.length - 1].role === "assistant";
}

/**
 * 応答が返ってきた後のターン数。
 * 質問を変えてもらった応答は数えない。数えると、くどい質問から逃げるたびに
 * 上限が近づき、肝心の手順が聞けないまま打ち切られる。
 */
export const turnsAfterReply = (turnsInPhase: number, rephrase: boolean): number =>
  rephrase ? turnsInPhase : turnsInPhase + 1;

/**
 * 切り上げてよいか。応答の途中は中途半端な発言が残るので不可。
 * 取得に失敗し続けているとき（error）こそ抜けられる必要があるので可。
 * 「次へ」の案内が出ているなら、そちらが正規の進み方なので出さない。
 */
export function canSkipPhase(v: ControlView): boolean {
  if (v.completedAt) return false;
  if (v.status !== "idle" && v.status !== "error") return false;
  return v.pendingPhase === null;
}

/** 切り上げた先。最後のステップなら完了 */
export const skipTarget = (mode: StoryMode, current: AnyPhaseId): AnyPhaseId | "done" =>
  nextPhase(mode, current);
