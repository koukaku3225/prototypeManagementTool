/**
 * goalCardLabel のテスト。
 *
 * label 未設定の古いカードでも壊れず、vision の長文をそのまま
 * 選択肢に流さないことだけを確認する。実行は `npm test`。
 */
import assert from "node:assert/strict";

/*
 * sessionStorage は Node に無い。goal-card.ts の下書き機能はこれに依存するので、
 * storage.test.mjs と同じやり方で、最小の差し替え可能な実装を先に置く。
 */
class FakeStorage {
  constructor() {
    this.map = new Map();
    this.throwOnSet = false;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.throwOnSet) throw new Error("denied");
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}
const session = new FakeStorage();
globalThis.sessionStorage = session;

const {
  goalCardLabel,
  goalSelectOptions,
  presetCardIdFrom,
  stashPendingCard,
  peekPendingCard,
  clearPendingCard,
} = await import("../src/lib/goal-card.ts");

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

function card(over) {
  return {
    id: "x",
    createdAt: "",
    updatedAt: "",
    coachId: "kaede",
    vision: { raw: "", refined: "" },
    meaning: { whyChain: [], values: [], motivationType: "internal", reframed: null, reframedFrom: null },
    smart: { specific: "", measurable: "", metricUnit: null, metricTarget: null, deadline: "", achievableNote: "" },
    woop: { wish: "", outcome: "", obstacles: [] },
    commitment: { accepted: false, acceptedAt: null, userWords: null },
    editedFields: [],
    ...over,
  };
}

t("label があればそれをそのまま使う", () => {
  assert.equal(
    goalCardLabel(card({ label: "副業", vision: { raw: "", refined: "長い文章がここに入る想定" } })),
    "副業",
  );
});

t("label が空文字・空白のみなら vision にフォールバックする", () => {
  assert.equal(goalCardLabel(card({ label: "  ", vision: { raw: "", refined: "短い目標" } })), "短い目標");
});

t("label が無いと vision.refined を短く切り詰める", () => {
  const label = goalCardLabel(card({ vision: { raw: "", refined: "1234567890123456789" } }));
  assert.equal(label, "12345678901234…");
});

t("label も vision も無ければプレースホルダを返す", () => {
  assert.equal(goalCardLabel(card()), "（未記入の目標）");
});

// -------------------------------------------------------------- 未保存の下書き

t("置いた下書きは、同じidで取り出せる", () => {
  session.map.clear();
  const c = card({ id: "draft-1" });
  assert.equal(stashPendingCard(c), true);
  assert.deepEqual(peekPendingCard("draft-1"), c);
});

t("覗いても消えない（StrictModeでeffectが2回走っても失わない）", () => {
  session.map.clear();
  stashPendingCard(card({ id: "draft-1" }));
  assert.notEqual(peekPendingCard("draft-1"), null);
  assert.notEqual(peekPendingCard("draft-1"), null, "2回目も取れる");
});

t("消したあとは取れない（永続化できたら置き場から外す）", () => {
  session.map.clear();
  stashPendingCard(card({ id: "draft-1" }));
  clearPendingCard("draft-1");
  assert.equal(peekPendingCard("draft-1"), null);
});

t("無いidを取り出そうとしたら null（見つからない扱いにできる）", () => {
  session.map.clear();
  assert.equal(peekPendingCard("no-such-id"), null);
});

t("違うidの下書きは取り出せない", () => {
  session.map.clear();
  stashPendingCard(card({ id: "draft-a" }));
  assert.equal(peekPendingCard("draft-b"), null);
  // draft-a はまだ置き場に残っている
  assert.notEqual(peekPendingCard("draft-a"), null);
});

t("壊れたJSONが入っていても落ちずに null", () => {
  session.map.clear();
  session.map.set("gc.pendingCard.broken", "{ではない");
  assert.equal(peekPendingCard("broken"), null);
});

t("無いidを消しても落ちない", () => {
  session.map.clear();
  assert.doesNotThrow(() => clearPendingCard("no-such-id"));
});

t("sessionStorageが使えない環境では、置くのに失敗したとstashが伝える", () => {
  session.map.clear();
  session.throwOnSet = true;
  try {
    assert.equal(stashPendingCard(card({ id: "draft-x" })), false);
  } finally {
    session.throwOnSet = false;
  }
});

// ------------------------------------------ 「どの目標のためか」の選択肢

t("進行中の目標だけが選択肢に並ぶ", () => {
  const opts = goalSelectOptions(
    [card({ id: "a", label: "副業" }), card({ id: "b", label: "英語", status: "done" })],
    null,
  );
  assert.deepEqual(opts, [{ id: "a", label: "副業" }]);
});

t("status が無い古いカードは進行中として並ぶ", () => {
  const opts = goalSelectOptions([card({ id: "a", label: "副業" })], null);
  assert.deepEqual(opts, [{ id: "a", label: "副業" }]);
});

t("いま紐づいている目標が完了済みでも、選択肢に残る", () => {
  const opts = goalSelectOptions(
    [card({ id: "a", label: "副業" }), card({ id: "b", label: "英語", status: "done" })],
    "b",
  );
  assert.deepEqual(opts, [
    { id: "a", label: "副業" },
    { id: "b", label: "英語（完了）" },
  ]);
});

t("紐づいている目標が一覧に無ければ、削除されたものとして残す", () => {
  const opts = goalSelectOptions([card({ id: "a", label: "副業" })], "z");
  assert.deepEqual(opts, [
    { id: "a", label: "副業" },
    { id: "z", label: "（削除された目標）" },
  ]);
});

t("紐づいている目標が進行中なら、二重に並べない", () => {
  const opts = goalSelectOptions([card({ id: "a", label: "副業" })], "a");
  assert.equal(opts.length, 1);
});

t("紐づけていない（null）なら、余計な選択肢は増えない", () => {
  const opts = goalSelectOptions([card({ id: "a", label: "副業" })], null);
  assert.equal(opts.length, 1);
});

t("目標が1件も無ければ空", () => {
  assert.deepEqual(goalSelectOptions([], null), []);
});

// ------------------------------------- 目標から時間割へ来たときの引き継ぎ

t("?card= の目標が進行中なら、そのidを返す", () => {
  const cards = [card({ id: "a" })];
  assert.equal(presetCardIdFrom("?card=a", cards), "a");
});

t("?card= が無ければ null", () => {
  assert.equal(presetCardIdFrom("", [card({ id: "a" })]), null);
  assert.equal(presetCardIdFrom("?date=2026-09-08", [card({ id: "a" })]), null);
});

t("実在しない目標のidは無視する（URLは書き換えられる）", () => {
  assert.equal(presetCardIdFrom("?card=zzz", [card({ id: "a" })]), null);
});

t("完了した目標は引き継がない（古いリンクを踏んだとき）", () => {
  const cards = [card({ id: "a", status: "done" })];
  assert.equal(presetCardIdFrom("?card=a", cards), null);
});

t("status が無い古いカードは進行中として引き継ぐ", () => {
  assert.equal(presetCardIdFrom("?card=a", [card({ id: "a" })]), "a");
});

t("他のパラメータが混ざっていても読める", () => {
  assert.equal(
    presetCardIdFrom("?from=goal&card=a&x=1", [card({ id: "a" })]),
    "a",
  );
});

t("目標が1件も無ければ null", () => {
  assert.equal(presetCardIdFrom("?card=a", []), null);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
