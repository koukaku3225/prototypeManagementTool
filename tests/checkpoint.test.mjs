/**
 * 中間目標（週/月）の計算のテスト。
 *
 * 期間の境界（週の始まり、月末日数）を目で見て正しさを判断するのは難しく、
 * 間違えると「まだ残っているのに0日と出る」という一番気づきにくい壊れ方をする。
 */
process.env.TZ = "Asia/Tokyo";

import assert from "node:assert/strict";
import {
  daysLeft,
  defaultPeriod,
  elapsedRatio,
  emptyCheckpoint,
  isPeriodOver,
  nearestActive,
  totalDays,
} from "../src/lib/checkpoint.ts";

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

const cp = (over = {}) => ({
  id: "cp-1",
  cardId: "card-1",
  title: "",
  period: { kind: "week", start: "2026-09-07", end: "2026-09-13" },
  status: "active",
  createdAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
  ...over,
});

t("週の既定期間は月曜始まり7日間", () => {
  // 2026-09-13は日曜。その週の月曜は2026-09-07
  const p = defaultPeriod("week", new Date("2026-09-13T12:00:00+09:00"));
  assert.deepEqual(p, { start: "2026-09-07", end: "2026-09-13" });
});

t("月の既定期間は1日〜末日（月末日数を数え間違えない）", () => {
  const feb = defaultPeriod("month", new Date("2026-02-10T12:00:00+09:00"));
  assert.deepEqual(feb, { start: "2026-02-01", end: "2026-02-28" }); // 2026は平年
  const apr = defaultPeriod("month", new Date("2026-04-15T12:00:00+09:00"));
  assert.deepEqual(apr, { start: "2026-04-01", end: "2026-04-30" });
});

t("残り日数は今日を含む", () => {
  const c = cp();
  assert.equal(daysLeft(c, "2026-09-13"), 1); // 最終日当日は残り1日
  assert.equal(daysLeft(c, "2026-09-07"), 7); // 初日は残り7日
});

t("期間が終わっていれば残り0日", () => {
  const c = cp();
  assert.equal(daysLeft(c, "2026-09-14"), 0);
  assert.equal(isPeriodOver(c, "2026-09-14"), true);
  assert.equal(isPeriodOver(c, "2026-09-13"), false);
});

t("消化率は経過日数ベースで0〜1に収まる", () => {
  const c = cp();
  assert.equal(totalDays(c), 7);
  assert.equal(elapsedRatio(c, "2026-09-07"), 1 / 7);
  assert.equal(elapsedRatio(c, "2026-09-13"), 1);
  // 期間開始前・終了後でも 0〜1 の範囲に収める
  assert.equal(elapsedRatio(c, "2026-09-01"), 0);
  assert.equal(elapsedRatio(c, "2026-09-20"), 1);
});

t("いちばん今見るべき1件は、活動中のうち期限が近い順", () => {
  const near = cp({ id: "near", status: "active", period: { kind: "week", start: "2026-09-07", end: "2026-09-10" } });
  const far = cp({ id: "far", status: "active", period: { kind: "week", start: "2026-09-07", end: "2026-09-20" } });
  const done = cp({ id: "done", status: "done", period: { kind: "week", start: "2026-09-01", end: "2026-09-02" } });
  assert.equal(nearestActive([far, done, near]).id, "near");
});

t("活動中が1件も無ければ null", () => {
  assert.equal(nearestActive([cp({ status: "done" }), cp({ status: "abandoned" })]), null);
  assert.equal(nearestActive([]), null);
});

t("emptyCheckpoint は指定した種類の既定期間を持つ", () => {
  const c = emptyCheckpoint("card-1", "month");
  assert.equal(c.cardId, "card-1");
  assert.equal(c.period.kind, "month");
  assert.equal(c.status, "active");
  assert.equal(c.title, "");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
