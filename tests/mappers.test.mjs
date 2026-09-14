/**
 * mappers.ts のテスト。
 *
 * goal_cards.smart_deadline は Postgres の date 型。手入力の目標で期限に
 * 「3年後」と書くと、upsert が 22007 で拒否され、目標がクラウドに届かない。
 * すると目標を参照する習慣・予定も 23503（外部キー違反）で連鎖して止まり、
 * 画面の帯には最後の習慣のエラーだけが出て、本当の原因が隠れた（2026-09-14 本番で発生）。
 */
import assert from "node:assert/strict";

const { goalCardToRow, checkpointToRow, checkpointFromRow } = await import("../src/lib/supabase/mappers.ts");

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

const card = (deadline) => ({
  id: "f5d40667-55fb-4084-9fbb-df21a03b3df2",
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
  coachId: "kaede",
  vision: { raw: "", refined: "月々5万円を稼ぐ力" },
  meaning: { whyChain: [], values: [], motivationType: "internal", reframed: null, reframedFrom: null },
  smart: { specific: "", measurable: "", metricUnit: null, metricTarget: null, deadline, achievableNote: "" },
  woop: { wish: "", outcome: "", obstacles: [] },
  commitment: { accepted: false, acceptedAt: null, userWords: null },
  editedFields: [],
});

const deadlineOf = (d) => goalCardToRow(card(d), "u").smart_deadline;

t("日付の期限はそのまま送る", () => {
  assert.equal(deadlineOf("2026-10-31"), "2026-10-31");
});

t("「3年後」のような文章の期限は null で送る（date 型に入らない）", () => {
  assert.equal(deadlineOf("3年後"), null);
});

t("空の期限は null", () => {
  assert.equal(deadlineOf(""), null);
});

t("形だけ日付で、実在しない日は null", () => {
  assert.equal(deadlineOf("2026-02-30"), null);
  assert.equal(deadlineOf("2026-13-01"), null);
});

t("日付の前後に文字があれば null", () => {
  assert.equal(deadlineOf("2026-10-31まで"), null);
});

// ---- 中間目標（checkpoints テーブル、R16 2026-09-14） ----

const cpLocal = (over = {}) => ({
  id: "0b0f2a4e-1111-4a4a-8a8a-000000000001",
  cardId: "f5d40667-55fb-4084-9fbb-df21a03b3df2",
  title: "今週3本書く",
  period: { kind: "week", start: "2026-09-14", end: "2026-09-20" },
  status: "active",
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T01:00:00.000Z",
  ...over,
});

t("中間目標を行にして、行から戻すと元に戻る", () => {
  const c = cpLocal({
    evaluation: {
      motives: { identified: 8, intrinsic: 7, introjected: 3, external: 2 },
      linkedValues: ["成長"],
      whyItMatters: "自分で稼ぐ力",
      hasBuddy: true,
      buddyNote: "友人に報告",
      updatedAt: "2026-09-14T02:00:00.000Z",
    },
  });
  const row = checkpointToRow(c, "user-1");
  assert.equal(row.user_id, "user-1");
  assert.equal(row.card_id, c.cardId);
  assert.equal(row.period_kind, "week");
  assert.equal(row.period_start, "2026-09-14");
  assert.equal(row.period_end, "2026-09-20");
  assert.deepEqual(checkpointFromRow(row), c);
});

t("評価の無い中間目標は evaluation を null で送り、null で戻す", () => {
  const row = checkpointToRow(cpLocal(), "u");
  assert.equal(row.evaluation, null, "undefined のままだと列が送られず、消した評価がクラウドに残る");
  assert.equal(checkpointFromRow(row).evaluation, null);
});

const { timeBoxToRow, timeBoxFromRow } = await import("../src/lib/supabase/mappers.ts");

const tb = (over = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  date: "2026-09-15",
  start: "12:00",
  end: "13:00",
  title: "飯",
  cardId: null,
  color: null,
  habitId: null,
  meta: { why: "", obstacle: "", counter: "" },
  completedAt: null,
  review: null,
  googleEventId: null,
  updatedAt: "2026-09-14T00:00:00.000Z",
  createdAt: "2026-09-14T00:00:00.000Z",
  ...over,
});

t("取り込んだ枠の出どころ・予定ID・非表示・削除済みを送って戻せる", () => {
  // 送り忘れると、別端末では「アプリの枠」に見えて編集でき、消すと戻らない
  const local = tb({
    source: "google",
    sourceEventId: "abc_20260915T030000Z",
    hiddenAt: "2026-09-14T01:00:00.000Z",
    sourceGoneAt: "2026-09-14T02:00:00.000Z",
  });
  const row = timeBoxToRow(local, "u");
  assert.equal(row.source, "google");
  assert.equal(row.source_event_id, "abc_20260915T030000Z");
  assert.equal(row.hidden_at, "2026-09-14T01:00:00.000Z");
  assert.equal(row.source_gone_at, "2026-09-14T02:00:00.000Z");
  const back = timeBoxFromRow({ ...row, start_time: "12:00:00", end_time: "13:00:00" });
  assert.equal(back.source, "google");
  assert.equal(back.sourceEventId, local.sourceEventId);
  assert.equal(back.hiddenAt, local.hiddenAt);
  assert.equal(back.sourceGoneAt, local.sourceGoneAt);
});

t("アプリの枠は source を app で送り、null の非表示を明示する（消した非表示がクラウドに残らない）", () => {
  const row = timeBoxToRow(tb(), "u");
  assert.equal(row.source, "app");
  assert.equal(row.source_event_id, null);
  assert.equal(row.hidden_at, null);
  assert.equal(row.source_gone_at, null);
  const back = timeBoxFromRow({ ...row, start_time: "12:00:00", end_time: "13:00:00", source: null });
  assert.equal(back.source, "app", "列が無い古い行はアプリの枠として読む");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
