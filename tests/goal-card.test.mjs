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
  firstStepMeta,
  deleteImpactText,
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

// ---------------------------------------------------------- firstStepMeta

const OBSTACLE = {
  text: "動画を見た流れで別のことを始めてしまう",
  plan: { if: "動画を見終わったら", then: "すぐタイマーをかける" },
};

t("障害と場所の両方があれば、どちらも counter に残す", () => {
  const meta = firstStepMeta({
    rationale: "月5万円の副業",
    vision: "",
    obstacle: OBSTACLE,
    where: "自室の机",
  });
  assert.equal(meta.why, "月5万円の副業");
  assert.equal(meta.obstacle, OBSTACLE.text);
  assert.equal(
    meta.counter,
    "もし動画を見終わったら → すぐタイマーをかける\n場所: 自室の机",
  );
});

t("障害があっても場所が捨てられない（これが直したかった不具合）", () => {
  const meta = firstStepMeta({
    rationale: "r",
    vision: "v",
    obstacle: OBSTACLE,
    where: "近所の体育館",
  });
  assert.ok(meta.counter.includes("近所の体育館"), "場所が counter から消えている");
});

t("場所が無いときの出力は従来どおり（If-Then だけ）", () => {
  const meta = firstStepMeta({
    rationale: "r",
    vision: "v",
    obstacle: OBSTACLE,
    where: null,
  });
  assert.equal(meta.counter, "もし動画を見終わったら → すぐタイマーをかける");
});

t("障害が無く場所だけあるときは「場所: …」だけ", () => {
  const meta = firstStepMeta({
    rationale: "",
    vision: "理想の姿",
    obstacle: undefined,
    where: "図書館",
  });
  assert.equal(meta.why, "理想の姿");
  assert.equal(meta.obstacle, "");
  assert.equal(meta.counter, "場所: 図書館");
});

t("障害も場所も無ければ counter は空文字", () => {
  const meta = firstStepMeta({ rationale: "r", vision: "v", obstacle: undefined, where: null });
  assert.equal(meta.counter, "");
});

t("空白だけの場所は書かない", () => {
  const meta = firstStepMeta({ rationale: "r", vision: "v", obstacle: undefined, where: "   " });
  assert.equal(meta.counter, "");
});

t("rationale が空なら why は vision で埋める", () => {
  const meta = firstStepMeta({ rationale: "", vision: "なりたい姿", obstacle: undefined, where: null });
  assert.equal(meta.why, "なりたい姿");
});

// ------------------------------------- 目標を消したときの巻き添えを言う1文

t("何も紐づいていなければ、余計なことは言わない", () => {
  assert.equal(
    deleteImpactText({ boxes: 0, habits: 0, archivedHabits: 0 }),
    null,
  );
});

t("予定だけなら、予定だけを言う", () => {
  assert.equal(
    deleteImpactText({ boxes: 3, habits: 0, archivedHabits: 0 }),
    "紐づく予定3件も一緒に消えます。",
  );
});

t("習慣だけなら、記録ごと消えることを言う", () => {
  assert.equal(
    deleteImpactText({ boxes: 0, habits: 2, archivedHabits: 0 }),
    "紐づく習慣2件（記録ごと）も一緒に消えます。",
  );
});

t("両方あれば中黒でつなぐ", () => {
  assert.equal(
    deleteImpactText({ boxes: 3, habits: 2, archivedHabits: 0 }),
    "紐づく予定3件・習慣2件（記録ごと）も一緒に消えます。",
  );
});

t("やめた習慣が混ざっているときは、その数まで言う", () => {
  assert.equal(
    deleteImpactText({ boxes: 0, habits: 2, archivedHabits: 1 }),
    "紐づく習慣2件（やめた1件と記録ごと）も一緒に消えます。",
  );
});

t("やめた習慣しか無くても、件数に数える（黙って消さない）", () => {
  assert.equal(
    deleteImpactText({ boxes: 0, habits: 1, archivedHabits: 1 }),
    "紐づく習慣1件（やめた1件と記録ごと）も一緒に消えます。",
  );
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
