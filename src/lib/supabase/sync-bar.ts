/**
 * 「同期が止まっています」の帯を出すかどうかの判断だけを切り出したもの。
 *
 * この帯は「黙って壊れるのを防ぐ」ために置いた。ところが判断が
 * コンポーネントの中に埋まっていたせいで、次の2つを同時に抱えていた。
 *
 *   1. 失敗を取り下げる経路が無く、一度出たら成功しても出続ける
 *   2. 一度「閉じる」と二度と戻らず、本物の失敗が完全に無言になる
 *
 * どちらも「黙って壊れる」形そのもので、帯の目的を裏切っていた。
 * ここに出して総当たりで固定する。
 */

/** sync.ts の SyncState["kind"] と同じ並び。依存を作らないために再掲する */
export type SyncStateKind =
  | "off"
  | "checking"
  | "pulling"
  | "pushing"
  | "ready"
  | "conflict"
  | "failed";

export interface SyncBarInput {
  stateKind: SyncStateKind;
  /** 直近の失敗の時刻（ISO8601）。失敗が無ければ null */
  errorAt: string | null;
  /** 本人が「閉じる」を押したときの鍵。まだ閉じていなければ null */
  dismissedKey: string | null;
}

/**
 * いま出そうとしている状況を表す鍵。
 *
 * 別の失敗が起きれば時刻が変わるので、閉じた記憶は自然に効かなくなる。
 * conflict は時刻を持たないので、状態そのものを鍵にする。
 */
export function syncBarKey(
  stateKind: SyncStateKind,
  errorAt: string | null,
): string {
  if (stateKind === "conflict") return "conflict";
  return errorAt ?? stateKind;
}

/**
 * 出すのは「本人が動かないと直らない状態」だけ。
 *
 * checking / pulling / pushing は放っておけば終わるので出さない。
 * off（未ログイン）も、同期しないことを選んでいるだけなので出さない。
 *
 * 状態が ready でも、個々の保存が失敗し続けることがある
 * （実際に timeboxes だけ弾かれ続けていた）。状態だけを見ていると
 * 取りこぼすので、直近の失敗も同じ重さで扱う。
 */
export function shouldShowSyncBar(i: SyncBarInput): boolean {
  const stalled =
    i.stateKind === "conflict" || i.stateKind === "failed" || i.errorAt !== null;
  if (!stalled) return false;
  return i.dismissedKey !== syncBarKey(i.stateKind, i.errorAt);
}
