/**
 * 初めて使う人に、対話への入口を出すかどうか。
 *
 * 既定の表示を時間割にしたことで、何も持っていない人が最初に見る画面が
 * **24時間の空グリッドと＋ボタンだけ**になった。このアプリの入口体験
 * （所要時間の明示・「理想を明日の一歩に変える」という期待設定）は
 * 目標タブの空状態にしかなく、自分でタブを押さない限り届かない。
 *
 * MVP仕様は「離脱の最大要因は"思ったより長い"」として入口の期待設定を
 * 必須にしているのに、既定ルートがそれを迂回していた。
 */

export interface OnboardingInput {
  /** 大きな物語があるか */
  hasBigStory: boolean;
  /** 目標カードの件数 */
  cardCount: number;
  /** 実体のある時間割の件数（習慣から起こしただけの枠は数えない） */
  timeBoxCount: number;
  /** 習慣の件数 */
  habitCount: number;
  /** 本人が「先に時間割だけ使う」を選んだか */
  dismissed: boolean;
}

/**
 * 出すのは「本当に何も持っていない人」だけ。
 *
 * 1つでも作ってあれば、その人はもう入口を通っている。
 * そこへ案内を出すのは邪魔にしかならないので出さない。
 * 閉じる選択も尊重する（判断を奪わない）。
 */
export function shouldShowOnboarding(i: OnboardingInput): boolean {
  if (i.dismissed) return false;
  return (
    !i.hasBigStory &&
    i.cardCount === 0 &&
    i.timeBoxCount === 0 &&
    i.habitCount === 0
  );
}
