/**
 * 目標の森のテスト。
 *
 * 見た目の約束（中間目標が n 個なら小枝 n 本、今回は終わりにした数だけ落ち葉、
 * 評価で選んだ価値観の根とだけつながる）は、画面を見ても数え間違いに気づきにくい。
 */
process.env.TZ = "Asia/Tokyo";

import assert from "node:assert/strict";
import { buildForest, habitVigor, MAX_TREES, twigState } from "../src/lib/forest.ts";
import { drawForest } from "../src/lib/forest-draw.ts";
import { emptyCheckpointEvaluation } from "../src/types/goal.ts";

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

const TODAY = "2026-09-13";
const VALUES = ["自由な探求心", "人としての成長", "親密な人間関係"];

const card = (id, over = {}) => ({
  id,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  status: "active",
  label: null,
  vision: { raw: "", refined: `目標${id}` },
  ...over,
});

const cp = (id, cardId, over = {}) => ({
  id,
  cardId,
  title: `中間${id}`,
  period: { kind: "week", start: "2026-09-07", end: "2026-09-13" },
  status: "active",
  evaluation: null,
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
  ...over,
});

const evalWith = (linkedValues) => ({ ...emptyCheckpointEvaluation(), linkedValues });

const build = (over = {}) =>
  buildForest({ values: VALUES, cards: [], checkpoints: {}, habits: {}, logs: [], today: TODAY, ...over });

t("小枝の状態: 期間中は芽、期間が過ぎて未記録は open、完了は花、終わりは落ち葉", () => {
  assert.equal(twigState(cp("a", "c"), TODAY), "bud");
  assert.equal(twigState(cp("a", "c", { period: { kind: "week", start: "2026-08-31", end: "2026-09-06" } }), TODAY), "open");
  assert.equal(twigState(cp("a", "c", { status: "done" }), TODAY), "flower");
  assert.equal(twigState(cp("a", "c", { status: "abandoned" }), TODAY), "fallen");
});

t("中間目標の数だけ小枝が生え、描画でも同じ数になる", () => {
  const m = build({
    cards: [card("c1")],
    checkpoints: { c1: [cp("x1", "c1"), cp("x2", "c1", { status: "done" }), cp("x3", "c1", { status: "abandoned" })] },
  });
  assert.equal(m.trees[0].twigs.length, 3);
  const g = drawForest(m);
  assert.equal(g.buds.length, 1);
  assert.equal(g.flowers.length, 1);
  assert.equal(g.fallen.length, 1);
});

t("価値観との紐付けは、評価で選んだ linkedValues の和集合。根の太さは中間目標の数", () => {
  const m = build({
    cards: [card("c1"), card("c2", { createdAt: "2026-08-02T00:00:00.000Z" })],
    checkpoints: {
      c1: [
        cp("x1", "c1", { evaluation: evalWith(["自由な探求心"]) }),
        cp("x2", "c1", { evaluation: evalWith(["人としての成長", "自由な探求心"]) }),
      ],
      c2: [cp("y1", "c2", { evaluation: evalWith(["親密な人間関係"]) })],
    },
  });
  assert.deepEqual(m.trees[0].links, [0, 1]);
  assert.deepEqual(m.trees[1].links, [2]);
  assert.deepEqual(m.strength, [2, 1, 1]);
  assert.equal(drawForest(m).roots.length, 3);
});

t("評価していない中間目標や、今の価値観に無い言葉はどの根ともつながらない", () => {
  const m = build({
    cards: [card("c1")],
    checkpoints: {
      c1: [
        cp("x1", "c1"),
        cp("x2", "c1", { evaluation: evalWith(["もう消した価値観"]) }),
      ],
    },
  });
  assert.deepEqual(m.trees[0].links, []);
  assert.deepEqual(m.strength, [0, 0, 0]);
});

t("木の並びは進行中（古い順）→ 完了、最大 MAX_TREES 本", () => {
  const cards = Array.from({ length: 8 }, (_, i) =>
    card(`c${i}`, { createdAt: `2026-08-0${i + 1}T00:00:00.000Z` }),
  );
  cards[0].status = "done";
  const m = build({ cards });
  assert.equal(m.trees.length, MAX_TREES);
  assert.equal(m.trees[0].cardId, "c1");
  assert.equal(m.trees.some((tr) => tr.cardId === "c0"), false); // 完了は進行中の後ろ。枠からあふれた
});

t("完了した目標の木には実がなる", () => {
  const m = build({ cards: [card("c1", { status: "done" })] });
  assert.equal(m.trees[0].done, true);
  assert.equal(drawForest(m).fruits.length, 3);
});

t("習慣の率がまだ出せないうちは、葉を黄ばませない中立の値", () => {
  assert.equal(habitVigor([], [], TODAY), 0.5);
  const fresh = { id: "h", cardId: "c1", title: "", schedule: { kind: "daily" }, createdAt: "2026-09-12T12:00:00.000Z", archivedAt: null };
  assert.equal(habitVigor([fresh], [], TODAY), 0.6);
});

t("続けていない習慣は vigor が下がる", () => {
  const habit = { id: "h", cardId: "c1", title: "", schedule: { kind: "daily" }, createdAt: "2026-08-01T00:00:00.000Z", archivedAt: null };
  const logs = ["2026-09-10", "2026-09-11", "2026-09-12"].map((date) => ({ habitId: "h", date, state: "done" }));
  const kept = habitVigor([habit], logs, TODAY);
  const none = habitVigor([habit], [], TODAY);
  assert.ok(kept > none, `${kept} > ${none}`);
  assert.equal(none, 0);
});

t("同じデータなら何度描いても同じ枝ぶり（id から決まる）", () => {
  const m = build({ cards: [card("c1")], checkpoints: { c1: [cp("x1", "c1")] } });
  assert.deepEqual(drawForest(m).wood, drawForest(m).wood);
});

t("木が1本も無くても、根と地面だけは描ける", () => {
  const g = drawForest(build());
  assert.equal(g.hits.length, 0);
  assert.equal(g.nodes.length, 3);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
