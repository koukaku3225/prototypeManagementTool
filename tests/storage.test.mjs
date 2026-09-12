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
/*
 * 本物と同じ「UUIDの形」を返す。連番なのは、どの呼び出しで作られたIDかを
 * テストから追えるようにするため。
 *
 * 以前は `uuid-1` のような、UUIDでない文字列を返していた。
 * これは実物と形が違うので、「UUIDでない値が混ざる」という種類の不具合
 * （Postgres の uuid 列に入らず、同期がまるごと拒否される）を
 * テストが素通ししてしまう。スタブは実物の性質を守る。
 */
globalThis.crypto.randomUUID = () => {
  const n = String(++uuidCounter).padStart(12, "0");
  return `00000000-0000-4000-8000-${n}`;
};

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

// ------------------------------------------------- 移行 v3（時間割IDのUUID化）

/**
 * 移行 v2 が作る `from-task-*` は Postgres の uuid 型に入らない。
 * reconcileCollection() は配列を1回の upsert で送るので、1件混ざるだけで
 * その日の時間割がまるごと保存されず、しかも本人には成功して見える。
 * v3 でローカル側を直しておく。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tbox(id, over = {}) {
  return {
    id,
    date: "2026-09-07",
    start: "10:00",
    end: "11:00",
    title: `予定 ${id}`,
    cardId: null,
    meta: { why: "", obstacle: "", counter: "" },
    completedAt: null,
    review: null,
    createdAt: "2026-09-07T00:00:00.000Z",
    ...over,
  };
}

t("移行v3: UUIDでない時間割IDが UUID に置き換わる", () => {
  reset({
    "gc.schemaVersion": "2",
    "gc.timeboxes": JSON.stringify([
      tbox("from-task-1"),
      tbox("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"),
    ]),
  });
  S.loadTimeBoxes();
  const after = parsed("gc.timeboxes");
  assert.equal(after.length, 2, "件数が変わった");
  for (const b of after) {
    assert.ok(UUID_RE.test(b.id), `UUIDになっていない: ${b.id}`);
  }
});

t("移行v3: 正しいIDは変えず、中身も持ち越す", () => {
  const keep = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  reset({
    "gc.schemaVersion": "2",
    "gc.timeboxes": JSON.stringify([
      tbox("from-task-9", { title: "移行された予定", start: "21:00" }),
      tbox(keep),
    ]),
  });
  S.loadTimeBoxes();
  const after = parsed("gc.timeboxes");
  assert.ok(
    after.some((b) => b.id === keep),
    "正しいIDまで置き換えている",
  );
  const moved = after.find((b) => b.title === "移行された予定");
  assert.ok(moved, "移行された予定が消えた");
  assert.equal(moved.start, "21:00", "中身が持ち越されていない");
  assert.notEqual(moved.id, "from-task-9", "IDが直っていない");
});

t("移行v3: 重複したIDも解消する", () => {
  // 同じ主キーが1回の upsert に2つ入ると、これも全体が弾かれる
  const dup = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
  reset({
    "gc.schemaVersion": "2",
    "gc.timeboxes": JSON.stringify([tbox(dup), tbox(dup, { title: "2件目" })]),
  });
  S.loadTimeBoxes();
  const after = parsed("gc.timeboxes");
  assert.equal(after.length, 2, "件数が変わった");
  assert.equal(new Set(after.map((b) => b.id)).size, 2, "IDが重複したまま");
});

t("移行v3: 何度実行しても同じ結果（冪等）", () => {
  reset({
    "gc.schemaVersion": "2",
    "gc.timeboxes": JSON.stringify([tbox("from-task-1"), tbox("from-task-2")]),
  });
  S.loadTimeBoxes();
  const after1 = raw("gc.timeboxes");
  S.__resetMigrationFlagForTest();
  S.loadTimeBoxes();
  assert.equal(raw("gc.timeboxes"), after1, "2回目で内容が変わった");
});

t("移行v3: 直すものが無ければ書き込まない", () => {
  // 無用な書き込みは同期フックに乗ってしまう
  const ids = [
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    "b1ffcd88-8d1a-4fe9-cc7e-7cc8ce491b22",
  ];
  const before = JSON.stringify(ids.map((id) => tbox(id)));
  reset({ "gc.schemaVersion": "2", "gc.timeboxes": before });
  S.loadTimeBoxes();
  assert.equal(raw("gc.timeboxes"), before, "触る必要が無いのに書き換えた");
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

t("archiveIfAbandoned: 未完了かつ発言のある対話は退避する", () => {
  reset();
  S.archiveIfAbandoned(session("s1", { messages: [{ role: "user" }] }));
  assert.equal(S.loadArchive().length, 1, "上書きの直前に呼んでも退避されていない");
  assert.equal(S.loadArchive()[0].id, "s1");
});

t("archiveIfAbandoned: セッションが無ければ何もしない", () => {
  reset();
  S.archiveIfAbandoned(null);
  assert.equal(S.loadArchive().length, 0);
});

t("archiveIfAbandoned: 一言も話していない対話は退避しない", () => {
  reset();
  S.archiveIfAbandoned(session("s1", { messages: [] }));
  assert.equal(S.loadArchive().length, 0, "空の対話まで一覧に残ると記録が荒れる");
});

t("archiveIfAbandoned: 完了済みは退避しない（archiveSession/clearSession が既に済んでいる前提）", () => {
  reset();
  S.archiveIfAbandoned(
    session("s1", {
      messages: [{ role: "user" }],
      completedAt: "2026-08-02T00:00:00.000Z",
    }),
  );
  assert.equal(S.loadArchive().length, 0);
});

t("archiveIfAbandoned: excludeId と一致する対話は、その場で退避しない", () => {
  reset();
  // history/[id] の「続きから話す」対象そのもの。resumeArchivedSession 側が引き継ぐ
  S.archiveIfAbandoned(session("s1", { messages: [{ role: "user" }] }), "s1");
  assert.equal(S.loadArchive().length, 0);
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

// ---------------------------------------------------------------- タイムボックス（カレンダー同期用の刻印）

t("upsertTimeBox は updatedAt を刻む", () => {
  reset();
  const before = new Date().toISOString();
  S.upsertTimeBox({
    id: "tb-1",
    date: "2026-09-05",
    start: "10:00",
    end: "10:30",
    title: "テスト",
    cardId: null,
    meta: { why: "", obstacle: "", counter: "" },
    completedAt: null,
    review: null,
    createdAt: before,
  });
  const saved = S.loadTimeBoxes().find((b) => b.id === "tb-1");
  assert.ok(saved.updatedAt, "updatedAt が入っていない");
  assert.ok(saved.updatedAt >= before, "updatedAt が古すぎる");
});

t("upsertTimeBox は呼ぶたびに updatedAt を更新する", () => {
  // 「どちらが新しいか」の判断に使うので、更新のたびに動かないと意味がない
  reset();
  S.upsertTimeBox({
    id: "tb-2",
    date: "2026-09-05",
    start: "10:00",
    end: "10:30",
    title: "一回目",
    cardId: null,
    meta: { why: "", obstacle: "", counter: "" },
    completedAt: null,
    review: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  const saved = S.loadTimeBoxes().find((b) => b.id === "tb-2");
  assert.notEqual(saved.updatedAt, "2026-09-01T00:00:00.000Z", "更新されていない");
});

// ---------------------------------------------------------------- 習慣の記録

/** テスト用の最小 HabitLog */
const hlog = (over = {}) => ({
  habitId: "h1",
  date: "2026-09-10",
  state: "done",
  at: "2026-09-10T06:05:00.000Z",
  note: null,
  mood: null,
  ...over,
});

t("clearHabitLogFromBox は、時刻の一致する done の記録を消す", () => {
  reset({ "gc.habitlogs": JSON.stringify([hlog()]) });
  S.clearHabitLogFromBox("h1", "2026-09-10", "2026-09-10T06:05:00.000Z");
  assert.deepEqual(S.loadHabitLogs(), []);
});

t("clearHabitLogFromBox は、時刻が違う記録には触れない（手で付けた記録を守る）", () => {
  reset({
    "gc.habitlogs": JSON.stringify([hlog({ at: "2026-09-10T21:00:00.000Z" })]),
  });
  S.clearHabitLogFromBox("h1", "2026-09-10", "2026-09-10T06:05:00.000Z");
  assert.equal(S.loadHabitLogs().length, 1);
});

t("clearHabitLogFromBox は、done 以外（skipped/partial/missed）には触れない", () => {
  for (const state of ["skipped", "partial", "missed"]) {
    reset({ "gc.habitlogs": JSON.stringify([hlog({ state })]) });
    S.clearHabitLogFromBox("h1", "2026-09-10", "2026-09-10T06:05:00.000Z");
    assert.equal(S.loadHabitLogs().length, 1, `${state} が消えた`);
  }
});

t("clearHabitLogFromBox は、記録が無くても落ちない", () => {
  reset({ "gc.habitlogs": JSON.stringify([]) });
  S.clearHabitLogFromBox("h1", "2026-09-10", "2026-09-10T06:05:00.000Z");
  assert.deepEqual(S.loadHabitLogs(), []);
});

t("deleteTimeBox は、完了済みの習慣枠を消すと、その枠が付けた記録も取り消す", () => {
  reset({
    "gc.schemaVersion": String(S.SCHEMA_VERSION),
    "gc.habitlogs": JSON.stringify([hlog({ at: "2026-09-10T06:05:00.000Z" })]),
    "gc.timeboxes": JSON.stringify([
      {
        id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        date: "2026-09-10",
        start: "06:00",
        end: "06:30",
        title: "腕立て",
        cardId: "c1",
        habitId: "h1",
        meta: { why: "", obstacle: "", counter: "" },
        completedAt: "2026-09-10T06:05:00.000Z",
        review: null,
        createdAt: "2026-09-10T00:00:00.000Z",
      },
    ]),
  });
  S.deleteTimeBox("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
  assert.deepEqual(S.loadHabitLogs(), [], "記録が残っている");
  assert.deepEqual(S.loadTimeBoxes(), [], "枠が残っている");
});

t("deleteTimeBox は、未完了の習慣枠を消しても記録に触れない", () => {
  reset({
    "gc.schemaVersion": String(S.SCHEMA_VERSION),
    "gc.habitlogs": JSON.stringify([hlog()]),
    "gc.timeboxes": JSON.stringify([
      {
        id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12",
        date: "2026-09-10",
        start: "06:00",
        end: "06:30",
        title: "腕立て",
        cardId: "c1",
        habitId: "h1",
        meta: { why: "", obstacle: "", counter: "" },
        completedAt: null,
        review: null,
        createdAt: "2026-09-10T00:00:00.000Z",
      },
    ]),
  });
  S.deleteTimeBox("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12");
  assert.equal(S.loadHabitLogs().length, 1);
});

t("deleteTimeBox は、習慣に紐づかない完了済みの枠では記録を触らない", () => {
  reset({
    "gc.schemaVersion": String(S.SCHEMA_VERSION),
    "gc.habitlogs": JSON.stringify([hlog()]),
    "gc.timeboxes": JSON.stringify([
      {
        id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13",
        date: "2026-09-10",
        start: "10:00",
        end: "10:30",
        title: "単発",
        cardId: null,
        meta: { why: "", obstacle: "", counter: "" },
        completedAt: "2026-09-10T10:05:00.000Z",
        review: null,
        createdAt: "2026-09-10T00:00:00.000Z",
      },
    ]),
  });
  S.deleteTimeBox("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13");
  assert.equal(S.loadHabitLogs().length, 1);
});

// ---------------------------------------------------------------- 消したものを待たせない

/*
 * 目標を消すと、書き込みは3本走る。
 *   gc.cards      … 素通し（すぐ送る）
 *   gc.habits     … まとめる対象（1.5秒待つ）
 *   gc.timeboxes  … まとめる対象（1.5秒待つ）
 *
 * クラウド側の外部キーは `timeboxes.card_id` を SET NULL にするだけで
 * 行は残すので、待っている間にタブが閉じると「目標に紐づかない枠」が
 * クラウドに残り、次の取り込みで復活する（2026-09-11 レビュー指摘1）。
 * storage 側から待ちを解かせていることを、実物の待ち行列で確かめる。
 */
const { createPushQueue } = await import("../src/lib/supabase/push-queue.ts");

/** 同期側の繋ぎ込みを、実物の待ち行列で再現する。タイマーは進めない */
function wireSync() {
  const sent = [];
  const timers = new Map();
  let next = 1;
  const q = createPushQueue({
    debounced: ["gc.timeboxes", "gc.habits"],
    send: (key, value) => sent.push(key),
    setTimer: (fn, ms) => {
      const id = next++;
      timers.set(id, fn);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  S.setSyncHook((key, value) => q.push(key, value));
  S.setSyncFlushHook(() => q.flush());
  return {
    sent,
    pending: () => q.pendingKeys(),
    unwire: () => {
      S.setSyncHook(null);
      S.setSyncFlushHook(null);
    },
  };
}

t("deleteCard は、まとめ待ちを残さずに送り切る", () => {
  reset();
  S.upsertCard(card("a"));
  S.upsertCard(card("b"));
  S.upsertHabit({
    id: "00000000-0000-4000-8000-000000009101",
    cardId: "a",
    title: "毎朝30分",
    minimalTitle: "",
    estimateMin: 30,
    schedule: { kind: "daily" },
    startTime: null,
    where: null,
    cue: null,
    createdAt: "2026-09-13T00:00:00.000Z",
    archivedAt: null,
  });
  const sync = wireSync();
  try {
    S.deleteCard("a");
    assert.deepEqual(
      sync.pending(),
      [],
      "待ちが残っていると、閉じた瞬間にクラウドへ孤児の枠が残る",
    );
    // 消した4本すべてが送られている（cards と habitlogs は素通し、
    // habits / timeboxes は待ち行列を解いた flush 経由）
    assert.deepEqual(
      [...sync.sent].sort(),
      ["gc.cards", "gc.habitlogs", "gc.habits", "gc.timeboxes"],
    );
  } finally {
    sync.unwire();
  }
});

t("deleteCard の送り切りは、関係ない編集の待ちも道連れにする（捨てはしない）", () => {
  reset();
  S.upsertCard(card("a"));
  const sync = wireSync();
  try {
    // 予定シートを打っている途中（まとめ待ちに乗っている状態）
    S.upsertTimeBox({
      id: "00000000-0000-4000-8000-000000009001",
      date: "2026-09-13",
      start: "10:00",
      end: "10:30",
      title: "編集中",
      cardId: null,
      meta: { why: "", obstacle: "", counter: "" },
      completedAt: null,
      review: null,
      createdAt: "2026-09-13T00:00:00.000Z",
    });
    assert.deepEqual(sync.pending(), ["gc.timeboxes"], "前提：待ちに乗っている");
    S.deleteCard("a");
    assert.deepEqual(sync.pending(), []);
    // 待っていた編集は捨てられず、送られている
    assert.ok(sync.sent.includes("gc.timeboxes"));
  } finally {
    sync.unwire();
  }
});

t("ふつうの保存は、いままでどおりまとめ待ちに乗る", () => {
  reset();
  const sync = wireSync();
  try {
    S.upsertTimeBox({
      id: "00000000-0000-4000-8000-000000009002",
      date: "2026-09-13",
      start: "11:00",
      end: "11:30",
      title: "あ",
      cardId: null,
      meta: { why: "", obstacle: "", counter: "" },
      completedAt: null,
      review: null,
      createdAt: "2026-09-13T00:00:00.000Z",
    });
    assert.deepEqual(
      sync.pending(),
      ["gc.timeboxes"],
      "ここが空になったら、1文字ごとの全件送信が戻っている",
    );
  } finally {
    sync.unwire();
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
