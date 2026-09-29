import type { GoalCard } from "@/types/goal";

/**
 * 目標カードどうしの親子関係。
 *
 * 親は「入れ物」で、中間目標・習慣・予定は一番下の目標に付ける
 * （docs/superpowers/specs/2026-09-29-goal-tree-design.md）。
 *
 * 親側に子の配列を持たせないのは、upsertCard がカードを丸ごと置換するため。
 * 親に配列を持つと、子を足した瞬間に古い親で上書きして関係が消える。
 * 線は必ず子（parentId）が持つ。
 *
 * ここの関数はすべて、親が見つからない・輪になっているデータでも止まるように
 * 書いてある。localStorage は手で編集できるし、端末をまたぐ同期でも途中の
 * 状態はあり得るので、壊れたデータで画面が固まるほうが害が大きい。
 */

/** 根からの深さの上限。刻みすぎると枝を作ること自体が目的になりやすい */
export const MAX_TREE_DEPTH = 5;

const isDone = (c: GoalCard) => (c.status ?? "active") === "done";
const byCreated = (a: GoalCard, b: GoalCard) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** 親の id。親が実在しないときは根（null）として扱う */
function parentIdOf(cards: GoalCard[], card: GoalCard): string | null {
  const p = card.parentId ?? null;
  if (!p) return null;
  return cards.some((c) => c.id === p) ? p : null;
}

/** 直接の子。parentId が null なら根の目標を返す */
export function childrenOf(cards: GoalCard[], parentId: string | null): GoalCard[] {
  return cards.filter((c) => parentIdOf(cards, c) === parentId).sort(byCreated);
}

/** 自分より下にある目標の id。自分は含まない */
export function descendantIds(cards: GoalCard[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (parent: string) => {
    for (const c of childrenOf(cards, parent)) {
      if (out.has(c.id)) continue; // 輪になっていても止まる
      out.add(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** 根を1として数えた深さ。輪になっていても打ち切る */
export function depthOf(cards: GoalCard[], id: string): number {
  const seen = new Set<string>([id]);
  let depth = 1;
  let card = cards.find((c) => c.id === id);
  while (card) {
    const p = parentIdOf(cards, card);
    if (!p || seen.has(p)) break;
    seen.add(p);
    depth++;
    if (depth > MAX_TREE_DEPTH + 1) break;
    card = cards.find((c) => c.id === p);
  }
  return depth;
}

/** その目標を頂点とした枝の段数（自分だけなら1） */
function subtreeHeight(cards: GoalCard[], id: string, guard = new Set<string>()): number {
  if (guard.has(id)) return 1;
  guard.add(id);
  const kids = childrenOf(cards, id);
  if (kids.length === 0) return 1;
  return 1 + Math.max(...kids.map((k) => subtreeHeight(cards, k.id, guard)));
}

export interface ParentCheck {
  ok: boolean;
  /** 断るときの、画面にそのまま出せる理由 */
  reason: string;
}

/** childId の親を parentId にしてよいか */
export function canSetParent(
  cards: GoalCard[],
  childId: string,
  parentId: string | null,
): ParentCheck {
  if (!parentId) return { ok: true, reason: "" };
  if (parentId === childId) return { ok: false, reason: "自分自身は親にできません。" };
  if (!cards.some((c) => c.id === parentId)) {
    return { ok: false, reason: "その目標が見つかりません。" };
  }
  if (descendantIds(cards, childId).has(parentId)) {
    return { ok: false, reason: "自分の下にある目標は親にできません。" };
  }
  const depth = depthOf(cards, parentId) + subtreeHeight(cards, childId);
  if (depth > MAX_TREE_DEPTH) {
    return { ok: false, reason: `段が深くなりすぎます（${MAX_TREE_DEPTH}段まで）。` };
  }
  return { ok: true, reason: "" };
}

/**
 * 「同時に進める目標は3つまで」で数える対象。
 * 進行中で、進行中の子を持たないもの＝実際に手を動かす先だけを数える。
 */
export function activeLeafCards(cards: GoalCard[]): GoalCard[] {
  return cards
    .filter((c) => !isDone(c))
    .filter((c) => childrenOf(cards, c.id).every(isDone))
    .sort(byCreated);
}

export interface GoalTreeNode {
  card: GoalCard;
  children: GoalTreeNode[];
  /** 自分より下にある達成済みの目標の数（孫も数える） */
  doneCount: number;
  /** 根を1とした深さ */
  depth: number;
}

/**
 * 画面に出す木。既定では達成済みを畳み、数（doneCount）だけ返す。
 * 達成済みを全部並べると、進行中がその中に埋もれる。
 */
export function buildGoalTree(
  cards: GoalCard[],
  opts: { includeDone?: boolean } = {},
): GoalTreeNode[] {
  const includeDone = Boolean(opts.includeDone);
  const seen = new Set<string>();

  const build = (card: GoalCard, depth: number): GoalTreeNode => {
    seen.add(card.id);
    const kids = childrenOf(cards, card.id).filter((c) => !seen.has(c.id));
    const children = kids
      .filter((c) => includeDone || !isDone(c))
      .map((c) => build(c, depth + 1));
    // 畳んだぶんも数えたいので、doneCount は kids 全部から数える
    const hidden = kids.filter((c) => isDone(c) && !includeDone);
    const doneCount =
      kids.filter(isDone).length +
      children.reduce((n, c) => n + c.doneCount, 0) +
      hidden.reduce((n, c) => n + descendantIds(cards, c.id).size, 0);
    return { card, children, doneCount, depth };
  };

  return childrenOf(cards, null)
    .filter((c) => includeDone || !isDone(c))
    .map((c) => build(c, 1));
}

/**
 * 親を消すときに、子を根へ上げたカードを返す（元の配列は書き換えない）。
 * 目標を消すと予定・習慣・中間目標まで連鎖で消えるので、子まで巻き添えにしない。
 */
export function detachChildren(cards: GoalCard[], parentId: string): GoalCard[] {
  return childrenOf(cards, parentId).map((c) => ({ ...c, parentId: null }));
}
