/**
 * mappers.ts のテスト。
 *
 * goal_cards.smart_deadline は Postgres の date 型。手入力の目標で期限に
 * 「3年後」と書くと、upsert が 22007 で拒否され、目標がクラウドに届かない。
 * すると目標を参照する習慣・予定も 23503（外部キー違反）で連鎖して止まり、
 * 画面の帯には最後の習慣のエラーだけが出て、本当の原因が隠れた（2026-09-14 本番で発生）。
 */
import assert from "node:assert/strict";

const { goalCardToRow } = await import("../src/lib/supabase/mappers.ts");

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

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
