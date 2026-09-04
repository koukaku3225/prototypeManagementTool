/**
 * storage.ts のテスト。
 *
 * ここが壊れると「保存したはずのものが消える」「復元したのに戻らない」という、
 * ユーザーから見て最も回復しづらい形で表面化する。しかも型では捕まらない。
 *
 * localStorage は Node に無いので、最小の実装を globalThis に置いてから
 * モジュールを読み込む。storage.ts は "use client" が付いているが、
 * tsx から import する分には単なる無害な文字列リテラルとして扱われる。
 */
import assert from "node:assert/strict";

// ---------------------------------------------------------------- 足場

/** 容量超過やアクセス拒否を再現できる、差し替え可能な localStorage */
class FakeStorage {
  constructor() {
    this.map = new Map();
    /** 次の setItem を失敗させる。"quota" | "denied" | null */
    this.failMode = null;
  }
  getItem(k) {
    if (this.failMode === "readDenied") throw new Error("denied");
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.failMode === "quota") {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    }
    if (this.failMode === "denied") throw new Error("write denied");
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
}

const store = new FakeStorage();
globalThis.localStorage = store;
if (!globalThis.crypto) globalThis.crypto = {};
let uuidCounter = 0;
globalThis.crypto.randomUUID = () => `uuid-${++uuidCounter}`;

const S = await import("../src/lib/storage.ts");

/** 各テストの前に呼ぶ。localStorage も移行フラグも初期化する */
function reset(initial = {}) {
  store.map.clear();
  store.failMode = null;
  for (const [k, v] of Object.entries(initial)) store.map.set(k, v);
  // resetAll() は移行フラグも false に戻す（＝次の read で移行が走る）
  S.resetAll();
  store.map.clear();
  for (const [k, v] of Object.entries(initial)) store.map.set(k, v);
}

const raw = (k) => store.map.get(k) ?? null;
const parsed = (k) => {
  const v = raw(k);
  return v === null ? null : JSON.parse(v);
};

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}\n`);
  }
}

/** テスト用の最小 GoalCard */
const card = (id, over = {}) => ({
  id,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  coachId: "kaede",
  vision: { raw: "", refined: "目標" + id },
  meaning: {
    whyChain: [],
    values: [],
    motivationType: "internal",
    reframed: null,
    reframedFrom: null,
  },
  smart: {
    specific: "",
    measurable: "",
    metricUnit: null,
    metricTarget: null,
    deadline: "",
    achievableNote: "",
  },
  woop: { wish: "", outcome: "", obstacles: [] },
  tasks: [],
  commitment: { accepted: false, acceptedAt: null, userWords: null },
  editedFields: [],
  ...over,
});

// ---------------------------------------------------------------- マイグレーション

t("版番号が無い古いデータは v0 として扱われ、現在の版まで上がる", () => {
  reset({ "gc.cards": JSON.stringify([card("a")]) });
  S.loadCards();
  assert.equal(parsed("gc.schemaVersion"), S.SCHEMA_VERSION);
});

t("単数の gc.card が gc.cards へ畳まれ、元は消える", () => {
  reset({ "gc.card": JSON.stringify(card("legacy")) });
  const all = S.loadCards();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "legacy");
  assert.equal(raw("gc.card"), null, "移行元が残っている");
});

t("gc.card と gc.cards が両方あっても、重複させずに畳む", () => {
  reset({
    "gc.card": JSON.stringify(card("dup")),
    "gc.cards": JSON.stringify([card("dup"), card("other")]),
  });
  const all = S.loadCards();
  assert.equal(all.length, 2, "同じIDが二重に入っている");
  assert.deepEqual(all.map((c) => c.id).sort(), ["dup", "other"]);
});

t("gc.card だけあって gc.cards が空でも失われない", () => {
  reset({ "gc.card": JSON.stringify(card("only")) });
  assert.equal(S.loadCards()[0].id, "only");
});

t("使われなくなった gc.stories は捨てられる", () => {
  reset({ "gc.stories": JSON.stringify([{ id: "s1" }]) });
  S.loadCards();
  assert.equal(raw("gc.stories"), null);
});

t("移行は何度実行しても同じ結果（冪等）", () => {
  reset({ "gc.card": JSON.stringify(card("x")) });
  S.loadCards();
  const after1 = raw("gc.cards");
  // 別のページ読み込みを模して、フラグを落としてもう一度走らせる
  S.__resetMigrationFlagForTest();
  S.loadCards();
  assert.equal(raw("gc.cards"), after1, "2回目で内容が変わった");
});

t("すでに現在の版なら、移行は何もしない", () => {
  reset({
    "gc.schemaVersion": String(S.SCHEMA_VERSION),
    "gc.card": JSON.stringify(card("untouched")),
  });
  S.loadCards();
  // 版が最新なので gc.card は畳まれず、そのまま残る
  assert.notEqual(raw("gc.card"), null, "最新版なのに移行が走った");
});

t("壊れた版番号は 0 とみなして移行し直す", () => {
  reset({ "gc.schemaVersion": '"こわれている"' });
  S.loadCards();
  assert.equal(parsed("gc.schemaVersion"), S.SCHEMA_VERSION);
});

t("空の localStorage でも落ちず、版番号だけ立つ", () => {
  reset();
  assert.deepEqual(S.loadCards(), []);
  assert.equal(S.loadBigStory(), null);
  assert.equal(S.loadSession(), null);
  assert.deepEqual(S.loadArchive(), []);
  assert.equal(parsed("gc.schemaVersion"), S.SCHEMA_VERSION);
});

// ---------------------------------------------------------------- 保存失敗

t("容量超過を検知して、種別つきで通知する", () => {
  reset();
  let got = null;
  const off = S.onStorageFailure((f) => (got = f));
  store.failMode = "quota";
  S.upsertCard(card("q"));
  assert.ok(got, "失敗が通知されていない");
  assert.equal(got.quota, true);
  assert.equal(got.key, "gc.cards");
  off();
});

t("容量超過以外の書き込み拒否は quota=false", () => {
  reset();
  let got = null;
  const off = S.onStorageFailure((f) => (got = f));
  store.failMode = "denied";
  S.upsertCard(card("d"));
  assert.ok(got);
  assert.equal(got.quota, false);
  off();
});

t("書けるようになったら失敗は自動で解除される", () => {
  reset();
  const seen = [];
  const off = S.onStorageFailure((f) => seen.push(f));
  store.failMode = "quota";
  S.upsertCard(card("f"));
  store.failMode = null;
  S.upsertCard(card("f"));
  assert.equal(S.getStorageFailure(), null, "解除されていない");
  assert.equal(seen.at(-1), null);
  off();
});

t("読み取りが例外を投げても落ちない", () => {
  reset({ "gc.cards": JSON.stringify([card("r")]) });
  S.loadCards();
  store.failMode = "readDenied";
  assert.deepEqual(S.loadCards(), [], "例外が漏れている");
  store.failMode = null;
});

t("壊れたJSONが入っていても落ちない", () => {
  reset({ "gc.cards": "{壊れている" });
  assert.deepEqual(S.loadCards(), []);
});

t("解除リスナーを外すと呼ばれなくなる", () => {
  reset();
  let count = 0;
  const off = S.onStorageFailure(() => count++);
  off();
  store.failMode = "quota";
  S.upsertCard(card("z"));
  store.failMode = null;
  assert.equal(count, 0);
});

// ---------------------------------------------------------------- カード操作

t("upsertCard は同じIDを増やさず置き換える", () => {
  reset();
  S.upsertCard(card("a", { updatedAt: "2026-08-01T00:00:00.000Z" }));
  S.upsertCard(card("a", { updatedAt: "2026-08-02T00:00:00.000Z" }));
  const all = S.loadCards();
  assert.equal(all.length, 1);
  assert.equal(all[0].updatedAt, "2026-08-02T00:00:00.000Z");
});

t("activeCards は done を数えない", () => {
  reset();
  S.upsertCard(card("a", { status: "active" }));
  S.upsertCard(card("b", { status: "done" }));
  S.upsertCard(card("c")); // status 未設定は active 扱い
  assert.equal(S.activeCards().length, 2);
});

t("canAddGoal は3枠で閉じ、done で空く", () => {
  reset();
  for (const id of ["a", "b", "c"]) S.upsertCard(card(id));
  assert.equal(S.canAddGoal(), false);
  S.setCardStatus("c", "done");
  assert.equal(S.canAddGoal(), true);
});

t("deleteCard は対象だけ消す", () => {
  reset();
  S.upsertCard(card("a"));
  S.upsertCard(card("b"));
  S.deleteCard("a");
  assert.deepEqual(S.loadCards().map((c) => c.id), ["b"]);
});

// ---------------------------------------------------------------- アーカイブ

const session = (id, over = {}) => ({
  id,
  mode: "small",
  coachId: "kaede",
  currentPhase: "diverge",
  phaseTurnCounts: {},
  phaseStatus: {},
  messages: [],
  startedAt: "2026-08-01T00:00:00.000Z",
  completedAt: null,
  variant: { commitmentStep: false, deliberateDelay: false },
  phaseEnteredAt: {},
  ...over,
});

t("同じIDを再アーカイブしても増えず、新しい方で置き換わる", () => {
  reset();
  S.archiveSession(session("s1", { messages: [] }));
  S.archiveSession(session("s1", { messages: [{ role: "user" }] }));
  const all = S.loadArchive();
  assert.equal(all.length, 1);
  assert.equal(all[0].messages.length, 1);
});

t("進行中のセッションはアーカイブより優先される", () => {
  reset();
  S.archiveSession(session("s1", { messages: [] }));
  S.saveSession(session("s1", { messages: [{ role: "user" }] }));
  assert.equal(S.loadArchivedSession("s1").messages.length, 1);
});

t("再開すると現在フェーズのターン数が0に戻る", () => {
  reset();
  S.archiveSession(
    session("s1", {
      currentPhase: "woop_wbs",
      phaseTurnCounts: { diverge: 4, woop_wbs: 7 },
      completedAt: "2026-08-02T00:00:00.000Z",
    }),
  );
  const r = S.resumeArchivedSession("s1");
  assert.equal(r.phaseTurnCounts.woop_wbs, 0, "上限のまま復帰すると一言も話せない");
  assert.equal(r.phaseTurnCounts.diverge, 4, "他フェーズまで消している");
  assert.equal(r.completedAt, null);
  assert.ok(r.resumedAt);
});

t("outcomeOfSession は対話から生まれた成果物を引く", () => {
  reset();
  S.upsertCard(card("c1", { sessionId: "s1" }));
  S.upsertCard(card("c2", { sessionId: "s2" }));
  assert.equal(S.outcomeOfSession("s1").card.id, "c1");
  assert.equal(S.outcomeOfSession("nope").card, null);
});

// ---------------------------------------------------------------- スナップショット

t("スナップショットは版番号ごと取り、戻すと移行が走り直す", () => {
  reset({ "gc.cards": JSON.stringify([card("a")]) });
  S.loadCards(); // 版を立てる
  const snap = S.captureState();
  assert.ok("gc.schemaVersion" in snap, "版番号が含まれていない");

  // 版番号の無い古いスナップショットを模す
  const old = { "gc.card": JSON.stringify(card("legacy")) };
  assert.equal(S.restoreState(old), true);
  assert.equal(parsed("gc.schemaVersion"), S.SCHEMA_VERSION, "移行が走っていない");
  assert.equal(S.loadCards()[0].id, "legacy");
});

t("復元は対象キー以外を書き込まない", () => {
  reset();
  S.restoreState({ "gc.cards": JSON.stringify([card("a")]), "evil.key": "x" });
  assert.equal(raw("evil.key"), null);
});

t("書き込みに失敗した復元は false を返す", () => {
  reset();
  store.failMode = "quota";
  assert.equal(S.restoreState({ "gc.cards": "[]" }), false);
  store.failMode = null;
});

t("importStateJson は形が違えば何も書かない", () => {
  reset({ "gc.cards": JSON.stringify([card("keep")]) });
  S.loadCards();
  assert.equal(S.importStateJson("[]"), false, "配列を受け入れている");
  assert.equal(S.importStateJson('{"gc.cards": 123}'), false, "文字列以外を受け入れている");
  assert.equal(S.importStateJson("{壊れている"), false);
  assert.equal(S.loadCards()[0].id, "keep", "失敗したのにデータが変わっている");
});

t("resetAll はレガシーキーも含めて全部消す", () => {
  reset({
    "gc.card": "{}",
    "gc.stories": "[]",
    "gc.cards": "[]",
    "gc.bigstory": "{}",
    "gc.profile": "{}",
    "gc.sessions": "[]",
    "gc.schemaVersion": "1",
  });
  S.resetAll();
  for (const k of ["gc.card", "gc.stories", "gc.cards", "gc.bigstory", "gc.profile", "gc.sessions", "gc.schemaVersion"]) {
    assert.equal(raw(k), null, `${k} が残っている`);
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
