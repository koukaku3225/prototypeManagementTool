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
  todayCheckpoints,
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

// ---- 今日の画面の先頭に出す中間目標（R19、2026-09-14） ----
//
// 期間が今日を含む、または期間が過ぎたのに閉じていない中間目標を、最大2件。
// 期限切れは「振り返る」を促すので先に出す。

const NOW = "2026-09-14"; // 月曜
const week = (id, start, end, over = {}) =>
  cp({ id, title: id, period: { kind: "week", start, end }, ...over });
const month = (id, start, end, over = {}) =>
  cp({ id, title: id, period: { kind: "month", start, end }, ...over });
const ids = (r) => r.shown.map((x) => x.checkpoint.id);

t("期間が今日を含む中間目標を、期限の近い順に出す", () => {
  const r = todayCheckpoints(
    [month("m", "2026-09-01", "2026-09-30"), week("w", "2026-09-14", "2026-09-20")],
    ["card-1"],
    NOW,
  );
  assert.deepEqual(ids(r), ["w", "m"]);
  assert.equal(r.rest, 0);
  assert.equal(r.shown[0].left, 7);
  assert.equal(r.shown[0].over, false);
});

t("期間の初日と最終日も「今日を含む」", () => {
  assert.deepEqual(ids(todayCheckpoints([week("first", NOW, "2026-09-20")], ["card-1"], NOW)), ["first"]);
  const last = todayCheckpoints([week("last", "2026-09-08", NOW)], ["card-1"], NOW);
  assert.deepEqual(ids(last), ["last"]);
  assert.equal(last.shown[0].left, 1, "最終日は残り1日");
  assert.equal(last.shown[0].over, false);
});

t("まだ始まっていない期間は出さない", () => {
  assert.deepEqual(ids(todayCheckpoints([week("next", "2026-09-21", "2026-09-27")], ["card-1"], NOW)), []);
});

t("期間が過ぎたのに閉じていないものは、期限切れとして先に出す", () => {
  const r = todayCheckpoints(
    [week("now", "2026-09-14", "2026-09-20"), week("old", "2026-09-07", "2026-09-13")],
    ["card-1"],
    NOW,
  );
  assert.deepEqual(ids(r), ["old", "now"]);
  assert.equal(r.shown[0].over, true);
  assert.equal(r.shown[0].left, 0);
});

t("完了・今回は終わりにしたものは出さない", () => {
  const r = todayCheckpoints(
    [
      week("done", "2026-09-07", "2026-09-13", { status: "done" }),
      week("ab", NOW, "2026-09-20", { status: "abandoned" }),
    ],
    ["card-1"],
    NOW,
  );
  assert.deepEqual(ids(r), []);
});

t("完了した目標・消えた目標の中間目標は出さない", () => {
  const r = todayCheckpoints([week("gone", NOW, "2026-09-20", { cardId: "card-x" })], ["card-1"], NOW);
  assert.deepEqual(ids(r), []);
});

t("見出しが空の中間目標は出さない（中身の無い行を作らない）", () => {
  const r = todayCheckpoints([week("blank", NOW, "2026-09-20", { title: "  " })], ["card-1"], NOW);
  assert.deepEqual(ids(r), []);
});

t("最大2件。残りの件数を返す", () => {
  const r = todayCheckpoints(
    [
      week("a", NOW, "2026-09-20"),
      week("b", NOW, "2026-09-18"),
      month("c", "2026-09-01", "2026-09-30"),
      week("d", NOW, "2026-09-16"),
    ],
    ["card-1"],
    NOW,
  );
  assert.deepEqual(ids(r), ["d", "b"]);
  assert.equal(r.rest, 2);
});

t("期限が同じなら、週を月より先に出す", () => {
  const r = todayCheckpoints(
    [month("m", "2026-09-01", "2026-09-30"), week("w", "2026-09-28", "2026-09-30")],
    ["card-1"],
    "2026-09-29",
  );
  assert.deepEqual(ids(r), ["w", "m"]);
});

t("1件も無ければ空で、落ちない", () => {
  assert.deepEqual(todayCheckpoints([], ["card-1"], NOW), { shown: [], rest: 0 });
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
