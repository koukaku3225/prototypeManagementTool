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
  evaluationSummary,
  isEvaluated,
  isPeriodOver,
  nearestActive,
  scoreTone,
  selfConcordanceScore,
  totalDays,
} from "../src/lib/checkpoint.ts";
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

// ------------------------------------- 建て方の評価（セルフコンコーダンス）

const motives = (over = {}) => ({
  identified: 5,
  intrinsic: 5,
  introjected: 5,
  external: 5,
  ...over,
});

t("未評価（すべて中立5）ならスコアは0", () => {
  assert.equal(selfConcordanceScore(motives()), 0);
});

t("同一化・内的が高いほどスコアはプラスになる", () => {
  const m = motives({ identified: 10, intrinsic: 9, introjected: 2, external: 1 });
  assert.equal(selfConcordanceScore(m), 10 + 9 - (2 + 1));
});

t("取入的・外的が高いほどスコアはマイナスになる", () => {
  const m = motives({ identified: 2, intrinsic: 1, introjected: 9, external: 10 });
  assert.equal(selfConcordanceScore(m), 2 + 1 - (9 + 10));
});

t("スコアの言い方は±6を境に切り替わる", () => {
  assert.equal(scoreTone(6).tone, "good");
  assert.equal(scoreTone(5).tone, "neutral");
  assert.equal(scoreTone(-5).tone, "neutral");
  assert.equal(scoreTone(-6).tone, "warn");
});

t("emptyCheckpointEvaluation は未評価（isEvaluated=false）から始まる", () => {
  const e = emptyCheckpointEvaluation();
  assert.equal(isEvaluated(e), false);
  assert.equal(isEvaluated(null), false);
  assert.equal(isEvaluated(undefined), false);
});

t("動機を1つでも中立から動かせば評価済みになる", () => {
  const e = emptyCheckpointEvaluation();
  e.motives.intrinsic = 8;
  assert.equal(isEvaluated(e), true);
});

t("価値観・仲間・一言のどれかがあれば、動機が中立のままでも評価済みになる", () => {
  assert.equal(isEvaluated({ ...emptyCheckpointEvaluation(), linkedValues: ["成長"] }), true);
  assert.equal(isEvaluated({ ...emptyCheckpointEvaluation(), hasBuddy: true }), true);
  assert.equal(isEvaluated({ ...emptyCheckpointEvaluation(), whyItMatters: "副業の柱にしたい" }), true);
});

t("要約は触った項目だけを言う", () => {
  assert.equal(evaluationSummary(emptyCheckpointEvaluation()), "");
  assert.equal(
    evaluationSummary({ ...emptyCheckpointEvaluation(), hasBuddy: true }),
    "仲間あり",
  );
  const e = {
    ...emptyCheckpointEvaluation(),
    motives: motives({ identified: 8, intrinsic: 8 }),
    linkedValues: ["成長", "自由"],
    hasBuddy: true,
  };
  assert.equal(evaluationSummary(e), "動機+6・価値観2件・仲間あり");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
