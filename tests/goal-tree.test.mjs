/**
 * 目標の親子関係のテスト。
 *
 * ここを間違えると「輪になって画面が固まる」「枠の数え方が狂って目標が作れない」
 * という形で出る。どちらも目で見て気づきにくいので機械で固定する。実行は `npm test`。
 */
import assert from "node:assert/strict";
import {
  MAX_TREE_DEPTH,
  activeLeafCards,
  buildGoalTree,
  canSetParent,
  childrenOf,
  depthOf,
  descendantIds,
  detachChildren,
} from "../src/lib/goal-tree.ts";

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}

/** テスト用の最小の目標カード */
const card = (id, parentId = null, status = "active", createdAt = `2026-01-${id.length}0T00:00:00.000Z`) => ({
  id,
  parentId,
  status,
  createdAt,
  updatedAt: createdAt,
  label: id,
  vision: { raw: id, refined: id },
});

// a ─ b ─ d
//   └ c
const sample = () => [
  card("a"),
  card("b", "a"),
  card("c", "a"),
  card("d", "b"),
];

t("childrenOf は直接の子だけを返す", () => {
  const cards = sample();
  assert.deepEqual(childrenOf(cards, "a").map((c) => c.id), ["b", "c"]);
  assert.deepEqual(childrenOf(cards, "b").map((c) => c.id), ["d"]);
  assert.deepEqual(childrenOf(cards, "d"), []);
});

t("childrenOf(null) は根の目標を返す", () => {
  assert.deepEqual(childrenOf(sample(), null).map((c) => c.id), ["a"]);
});

t("descendantIds は孫まで含み、自分は含まない", () => {
  assert.deepEqual([...descendantIds(sample(), "a")].sort(), ["b", "c", "d"]);
  assert.deepEqual([...descendantIds(sample(), "d")], []);
});

t("depthOf は根を1として数える", () => {
  const cards = sample();
  assert.equal(depthOf(cards, "a"), 1);
  assert.equal(depthOf(cards, "b"), 2);
  assert.equal(depthOf(cards, "d"), 3);
});

t("親が見つからない目標は根として扱う（データが壊れても止まらない）", () => {
  const cards = [card("x", "missing")];
  assert.equal(depthOf(cards, "x"), 1);
  assert.deepEqual(childrenOf(cards, null).map((c) => c.id), ["x"]);
});

t("親子が輪になっていても depthOf が止まる", () => {
  const cards = [card("p", "q"), card("q", "p")];
  assert.ok(depthOf(cards, "p") <= MAX_TREE_DEPTH + 1);
});

t("canSetParent は自分自身を親にできない", () => {
  assert.equal(canSetParent(sample(), "a", "a").ok, false);
});

t("canSetParent は自分の子孫を親にできない（循環になる）", () => {
  const r = canSetParent(sample(), "a", "d");
  assert.equal(r.ok, false);
  assert.match(r.reason, /下/);
});

t("canSetParent は関係のない目標を親にできる", () => {
  assert.equal(canSetParent(sample(), "c", "d").ok, true);
});

t("canSetParent は親を外す（null）を許す", () => {
  assert.equal(canSetParent(sample(), "d", null).ok, true);
});

t("canSetParent は深さの上限を超える付け替えを拒む", () => {
  // a(1) ─ b(2) ─ d(3) に、深さ3ぶんの枝をぶら下げると 5 を超える
  const cards = [
    ...sample(),
    card("e"),
    card("f", "e"),
    card("g", "f"),
  ];
  assert.equal(canSetParent(cards, "e", "d").ok, false);
});

t("canSetParent は上限ちょうどなら許す", () => {
  const cards = [...sample(), card("e"), card("f", "e")];
  // d(3) の下に e(4) ─ f(5)
  assert.equal(canSetParent(cards, "e", "d").ok, true);
});

t("activeLeafCards は進行中の子を持つ親を数えない", () => {
  const cards = sample();
  assert.deepEqual(activeLeafCards(cards).map((c) => c.id), ["c", "d"]);
});

t("activeLeafCards は子が全部完了した親を葉として数える", () => {
  const cards = [card("a"), card("b", "a", "done")];
  assert.deepEqual(activeLeafCards(cards).map((c) => c.id), ["a"]);
});

t("activeLeafCards は完了した目標を数えない", () => {
  const cards = [card("a", null, "done"), card("b")];
  assert.deepEqual(activeLeafCards(cards).map((c) => c.id), ["b"]);
});

t("buildGoalTree は既定で達成済みを畳み、数だけ返す", () => {
  const cards = [card("a"), card("b", "a"), card("c", "a", "done"), card("d", "a", "done")];
  const tree = buildGoalTree(cards);
  assert.deepEqual(tree.map((n) => n.card.id), ["a"]);
  assert.deepEqual(tree[0].children.map((n) => n.card.id), ["b"]);
  assert.equal(tree[0].doneCount, 2);
});

t("buildGoalTree は達成済みを含めると子として返す", () => {
  const cards = [card("a"), card("b", "a"), card("c", "a", "done")];
  const tree = buildGoalTree(cards, { includeDone: true });
  assert.deepEqual(tree[0].children.map((n) => n.card.id), ["b", "c"]);
  assert.equal(tree[0].doneCount, 1);
});

t("buildGoalTree の doneCount は孫の達成済みも数える", () => {
  const cards = [card("a"), card("b", "a"), card("c", "b", "done")];
  const tree = buildGoalTree(cards);
  assert.equal(tree[0].doneCount, 1);
  assert.equal(tree[0].children[0].doneCount, 1);
});

t("buildGoalTree は親が完了していても子を消さない", () => {
  const cards = [card("a", null, "done"), card("b", "a")];
  const tree = buildGoalTree(cards, { includeDone: true });
  assert.deepEqual(tree.map((n) => n.card.id), ["a"]);
  assert.deepEqual(tree[0].children.map((n) => n.card.id), ["b"]);
});

t("buildGoalTree は輪になったデータでも止まる", () => {
  const cards = [card("p", "q"), card("q", "p"), card("r")];
  const tree = buildGoalTree(cards, { includeDone: true });
  assert.deepEqual(tree.map((n) => n.card.id), ["r"]);
});

t("detachChildren は子の親を外したカードだけ返す", () => {
  const cards = sample();
  const moved = detachChildren(cards, "a");
  assert.deepEqual(moved.map((c) => c.id), ["b", "c"]);
  assert.deepEqual(moved.map((c) => c.parentId), [null, null]);
  // 元の配列は書き換えない
  assert.equal(cards.find((c) => c.id === "b").parentId, "a");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
