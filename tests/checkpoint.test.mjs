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
  // now を渡さないと「今日」が動いて結果が変わるので、必ず固定して比べる
  assert.equal(nearestActive([far, done, near], "2026-09-08").id, "near");
});

/*
 * 目標の一覧（/goals・/tree）は、この1件を「今週 …… 残り0日」として出す。
 * 期間が終わったものを先に返していたため、先週のまま閉じていない中間目標が
 * ずっと居座り、今週の中間目標が隠れていた（2026-09-20 に実機で確認）。
 */
t("期間が終わったものより、いま生きているものを先に返す", () => {
  const over = cp({ id: "over", period: { kind: "week", start: "2026-09-01", end: "2026-09-06" } });
  const live = cp({ id: "live", period: { kind: "week", start: "2026-09-07", end: "2026-09-13" } });
  assert.equal(nearestActive([over, live], "2026-09-10").id, "live");
});

t("生きているものが無ければ、いちばん最近終わったものを返す", () => {
  const old = cp({ id: "old", period: { kind: "week", start: "2026-08-24", end: "2026-08-30" } });
  const recent = cp({ id: "recent", period: { kind: "week", start: "2026-08-31", end: "2026-09-06" } });
  assert.equal(nearestActive([old, recent], "2026-09-10").id, "recent");
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

// ---------------------------------------------------------------- 中間目標タブ（2026-09-17）

const P = await import("../src/lib/checkpoint.ts");

const WEEK = { kind: "week", start: "2026-09-14", end: "2026-09-20" };
const cpOf = (over = {}) => ({
  id: "cp-1",
  cardId: "card-1",
  title: "副業に週10時間使う",
  period: WEEK,
  status: "active",
  measure: "time",
  target: 10,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
  ...over,
});
const boxOf = (over = {}) => ({
  id: `b-${Math.random()}`,
  date: "2026-09-15",
  start: "20:00",
  end: "21:30",
  title: "LP",
  cardId: "card-1",
  checkpointId: "cp-1",
  meta: { why: "", obstacle: "", counter: "" },
  completedAt: null,
  review: null,
  createdAt: "2026-09-14T00:00:00.000Z",
  ...over,
});

t("測り方が無い既存の中間目標は「達成」として扱う", () => {
  assert.equal(P.measureOf(cpOf({ measure: undefined })), "done");
});

t("時間：紐づけた予定の時間を合計し、完了した時間も別に返す", () => {
  const r = P.checkpointProgress(cpOf(), [
    boxOf(), // 1.5h 未完了
    boxOf({ start: "09:00", end: "12:00", completedAt: "x" }), // 3h 完了
  ]);
  assert.equal(r.value, 4.5);
  assert.equal(r.doneValue, 3);
  assert.equal(r.target, 10);
  assert.equal(r.ratio, 0.45);
  assert.equal(r.met, false);
});

t("時間：期間外・別の中間目標・非表示の予定は数えない", () => {
  const r = P.checkpointProgress(cpOf(), [
    boxOf({ date: "2026-09-13" }),
    boxOf({ date: "2026-09-21" }),
    boxOf({ checkpointId: "other" }),
    boxOf({ hiddenAt: "2026-09-15T00:00:00Z" }),
    boxOf({ start: "10:00", end: "11:00" }),
  ]);
  assert.equal(r.value, 1);
});

t("時間：目安に届いたら met、割合は1で止める", () => {
  const r = P.checkpointProgress(cpOf({ target: 2 }), [boxOf({ start: "08:00", end: "11:00" })]);
  assert.equal(r.met, true);
  assert.equal(r.ratio, 1);
});

t("回数：完了した予定の数＋手で足した数", () => {
  const r = P.checkpointProgress(cpOf({ measure: "count", target: 3, manualCount: 1 }), [
    boxOf({ completedAt: "x" }),
    boxOf(), // 未完了は数えない
  ]);
  assert.equal(r.value, 2);
  assert.equal(r.met, false);
});

t("達成：status が done なら値1・met", () => {
  assert.equal(P.checkpointProgress(cpOf({ measure: "done", target: null, status: "done" }), []).met, true);
  const r = P.checkpointProgress(cpOf({ measure: "done", target: null }), []);
  assert.equal(r.value, 0);
  assert.equal(r.met, false);
});

t("時間：Google で消された予定は数えない（時間割には薄く残るが、押さえた時間はもう無い）", () => {
  const r = P.checkpointProgress(cpOf(), [
    boxOf({ start: "09:00", end: "12:00" }), // 3h 生きている
    boxOf({ start: "13:00", end: "16:00", source: "google", sourceEventId: "ev-1", sourceGoneAt: "2026-09-18T10:00:00.000Z" }),
  ]);
  assert.equal(r.value, 3);
});

t("時間：Google で消されても、完了にしてあれば実際にやった記録なので数える", () => {
  const r = P.checkpointProgress(cpOf(), [
    boxOf({
      start: "13:00",
      end: "16:00",
      source: "google",
      sourceEventId: "ev-1",
      sourceGoneAt: "2026-09-18T10:00:00.000Z",
      completedAt: "2026-09-18T07:00:00.000Z",
    }),
  ]);
  assert.equal(r.value, 3);
  assert.equal(r.doneValue, 3);
});

t("回数：Google で消された未完了の予定は、手で足した数を巻き込まない", () => {
  const r = P.checkpointProgress(cpOf({ measure: "count", target: 3, manualCount: 1 }), [
    boxOf({ completedAt: "x" }),
    boxOf({ completedAt: null, source: "google", sourceEventId: "ev-2", sourceGoneAt: "2026-09-18T10:00:00.000Z" }),
  ]);
  assert.equal(r.value, 2);
});

t("進み具合の1行も、Google で消された予定を数えない", () => {
  const boxes = [
    boxOf({ start: "09:00", end: "12:00" }),
    boxOf({ start: "13:00", end: "16:00", source: "google", sourceEventId: "ev-1", sourceGoneAt: "2026-09-18T10:00:00.000Z" }),
  ];
  assert.equal(P.progressSummary(cpOf(), boxes), "3 / 10時間");
});

t("countsForCheckpoint：非表示と、Google で消された未完了だけを落とす", () => {
  assert.equal(P.countsForCheckpoint(boxOf()), true);
  assert.equal(P.countsForCheckpoint(boxOf({ hiddenAt: "x" })), false);
  assert.equal(P.countsForCheckpoint(boxOf({ sourceGoneAt: "x" })), false);
  assert.equal(P.countsForCheckpoint(boxOf({ sourceGoneAt: "x", completedAt: "y" })), true);
});

t("目安が無い（0や未設定）時間・回数でも割合は0で落ちない", () => {
  const r = P.checkpointProgress(cpOf({ target: null }), [boxOf()]);
  assert.equal(r.ratio, 0);
  assert.equal(r.met, false);
});

t("今の期間の中間目標：期間が今日を含む・生きている目標。できた（done）は残し、終わりにした（abandoned）は出さない", () => {
  // チェックした「達成」が一覧から消えると、取り消せず、できたことも見えなくなる
  const list = [
    cpOf({ id: "a" }),
    cpOf({ id: "ended", period: { kind: "week", start: "2026-09-07", end: "2026-09-13" } }),
    cpOf({ id: "future", period: { kind: "week", start: "2026-09-21", end: "2026-09-27" } }),
    cpOf({ id: "checked", measure: "done", status: "done" }),
    cpOf({ id: "gave-up", status: "abandoned" }),
    cpOf({ id: "orphan", cardId: "gone" }),
    cpOf({ id: "month", period: { kind: "month", start: "2026-09-01", end: "2026-09-30" } }),
  ];
  assert.deepEqual(
    P.currentCheckpoints(list, ["card-1"], "2026-09-17").map((c) => c.id),
    ["a", "checked", "month"],
  );
});

t("振り返り待ち：活動中のまま期間が終わったもの", () => {
  const list = [
    cpOf({ id: "a" }),
    cpOf({ id: "ended", period: { kind: "week", start: "2026-09-07", end: "2026-09-13" } }),
    cpOf({ id: "ended-closed", status: "abandoned", period: { kind: "week", start: "2026-09-07", end: "2026-09-13" } }),
  ];
  assert.deepEqual(P.pendingReviews(list, ["card-1"], "2026-09-17").map((c) => c.id), ["ended"]);
});

const LAST = { kind: "week", start: "2026-09-07", end: "2026-09-13" };
const NOW_DATE = new Date("2026-09-17T10:00:00");

t("振り返り：目安に届いていたら done で閉じ、同じ目安で次の週を作る", () => {
  const c = cpOf({ period: LAST, target: 2 });
  const r = P.closeAndCarryOver(c, [boxOf({ date: "2026-09-08", start: "08:00", end: "11:00" })], { kind: "same" }, NOW_DATE);
  assert.equal(r.closed.status, "done");
  assert.equal(r.next.status, "active");
  assert.deepEqual(r.next.period, { kind: "week", start: "2026-09-14", end: "2026-09-20" });
  assert.equal(r.next.target, 2);
  assert.equal(r.next.title, c.title);
  assert.equal(r.next.measure, "time");
  assert.equal(r.next.previousId, c.id);
  assert.notEqual(r.next.id, c.id);
  assert.equal(r.next.manualCount ?? 0, 0, "手で足した回数は引き継がない");
});

t("振り返り：届いていなければ abandoned で閉じ、目安を変えて続けられる", () => {
  const r = P.closeAndCarryOver(cpOf({ period: LAST }), [], { kind: "change", target: 8 }, NOW_DATE);
  assert.equal(r.closed.status, "abandoned");
  assert.equal(r.next.target, 8);
});

t("振り返り：今の期間に同じ目標・同じタイトルの中間目標がもうあれば、二重に作らない", () => {
  const existing = cpOf({ id: "this-week", period: WEEK });
  const same = P.closeAndCarryOver(cpOf({ id: "last", period: LAST }), [], { kind: "same" }, NOW_DATE, [existing]);
  assert.equal(same.closed.status, "abandoned");
  assert.equal(same.next, null);
  // 目安を変えるなら、既にあるほうの目安を変える（選んだのに何も起きない、にしない）
  const changed = P.closeAndCarryOver(cpOf({ id: "last", period: LAST }), [], { kind: "change", target: 8 }, NOW_DATE, [existing]);
  assert.equal(changed.next.id, "this-week");
  assert.equal(changed.next.target, 8);
});

t("振り返り：今の期間に同じものがあっても、終わりにした（abandoned）ものは数えずに新しく作る", () => {
  // 見えない行の目安を変えて「何も起きない」になっていた（2026-09-17 レビュー）
  const gaveUp = cpOf({ id: "gave-up", period: WEEK, status: "abandoned" });
  const r = P.closeAndCarryOver(cpOf({ id: "last", period: LAST }), [], { kind: "change", target: 8 }, NOW_DATE, [gaveUp]);
  assert.notEqual(r.next.id, "gave-up");
  assert.equal(r.next.status, "active");
  assert.equal(r.next.target, 8);
});

t("回数を1つ戻す：手で足したぶんだけ減らし、0より下げない", () => {
  assert.equal(P.withManualCountDelta(cpOf({ manualCount: 2 }), -1).manualCount, 1);
  assert.equal(P.withManualCountDelta(cpOf({ manualCount: 0 }), -1).manualCount, 0);
  assert.equal(P.withManualCountDelta(cpOf({}), 1).manualCount, 1);
});

t("予定がその中間目標の期間外なら、紐づけても数えないことが分かる", () => {
  assert.equal(P.boxInPeriod(cpOf(), { date: "2026-09-15" }), true);
  assert.equal(P.boxInPeriod(cpOf(), { date: "2026-09-21" }), false);
});

t("期間の見せ方：週は「今週／先週」ではなく日付、月は「9月」", () => {
  assert.equal(P.periodLabel({ kind: "week", start: "2026-09-07", end: "2026-09-13" }), "9/7〜9/13");
  assert.equal(P.periodLabel({ kind: "month", start: "2026-08-01", end: "2026-08-31" }), "2026年8月");
});

t("振り返り：終わりにするなら次は作らない", () => {
  const r = P.closeAndCarryOver(cpOf({ period: LAST }), [], { kind: "end" }, NOW_DATE);
  assert.equal(r.next, null);
});

t("振り返り：月の中間目標は今月として続く", () => {
  const c = cpOf({ period: { kind: "month", start: "2026-08-01", end: "2026-08-31" } });
  const r = P.closeAndCarryOver(c, [], { kind: "same" }, NOW_DATE);
  assert.deepEqual(r.next.period, { kind: "month", start: "2026-09-01", end: "2026-09-30" });
});

t("予定シートの選択肢：同じ目標・日付を含む・活動中。今選んでいるものは条件外でも残す", () => {
  const list = [
    cpOf({ id: "ok" }),
    cpOf({ id: "other-card", cardId: "card-2" }),
    cpOf({ id: "ended", period: LAST }),
    cpOf({ id: "closed", status: "done" }),
  ];
  assert.deepEqual(P.checkpointOptionsForBox(list, { cardId: "card-1", date: "2026-09-15", checkpointId: null }).map((c) => c.id), ["ok"]);
  assert.deepEqual(
    P.checkpointOptionsForBox(list, { cardId: "card-1", date: "2026-09-15", checkpointId: "closed" }).map((c) => c.id),
    ["ok", "closed"],
  );
  assert.deepEqual(P.checkpointOptionsForBox(list, { cardId: null, date: "2026-09-15", checkpointId: null }), []);
});

t("?checkpoint= から中間目標を引く。無い・閉じた・目標が完了なら null", () => {
  const list = [cpOf({ id: "a" }), cpOf({ id: "closed", status: "done" }), cpOf({ id: "done-card", cardId: "card-done" })];
  const cards = [{ id: "card-1" }, { id: "card-done", status: "done" }];
  assert.equal(P.presetCheckpointFrom("?checkpoint=a", list, cards)?.id, "a");
  assert.equal(P.presetCheckpointFrom("?checkpoint=closed", list, cards), null);
  assert.equal(P.presetCheckpointFrom("?checkpoint=done-card", list, cards), null);
  assert.equal(P.presetCheckpointFrom("?checkpoint=nope", list, cards), null);
  assert.equal(P.presetCheckpointFrom("", list, cards), null);
});

t("進み具合の表示：時間は小数1桁（整数なら小数なし）、回数は整数", () => {
  assert.equal(P.formatProgressValue("time", 4.25), "4.3");
  assert.equal(P.formatProgressValue("time", 4), "4");
  assert.equal(P.formatProgressValue("count", 2), "2");
});


t("目安の読み取り：時間は0より大きい数、回数は1以上の整数、達成は常に null", () => {
  assert.equal(P.parseCheckpointTarget("time", "7.5"), 7.5);
  assert.equal(P.parseCheckpointTarget("time", "0"), null);
  assert.equal(P.parseCheckpointTarget("time", ""), null); // Number("") は 0。空欄を0時間と読まない
  assert.equal(P.parseCheckpointTarget("time", "abc"), null);
  assert.equal(P.parseCheckpointTarget("count", "3"), 3);
  assert.equal(P.parseCheckpointTarget("count", "2.5"), null);
  assert.equal(P.parseCheckpointTarget("count", "-1"), null);
  assert.equal(P.parseCheckpointTarget("done", "5"), null);
});

t("振り返り：目安を変えるを選んで数が正しくないうちは、始められない（黙って同じ目安で続けない）", () => {
  const c = cpOf({ period: LAST });
  assert.equal(P.reviewPickReady(c, "change", ""), false);
  assert.equal(P.reviewPickReady(c, "change", "0"), false);
  assert.equal(P.reviewPickReady(c, "change", "8"), true);
  assert.equal(P.reviewPickReady(c, "same", ""), true);
  assert.equal(P.reviewPickReady(c, "end", undefined), true);
  assert.equal(P.reviewPickReady(c, undefined, "8"), false);
});

t("今日の画面の進み具合：時間は「5.5 / 10時間」、回数は「2 / 3回」、達成は出さない", () => {
  const boxes = [boxOf({ start: "10:00", end: "15:30" })];
  assert.equal(P.progressSummary(cpOf(), boxes), "5.5 / 10時間");
  assert.equal(P.progressSummary(cpOf({ measure: "count", target: 3, manualCount: 2 }), []), "2 / 3回");
  assert.equal(P.progressSummary(cpOf({ target: null }), boxes), "5.5時間");
  assert.equal(P.progressSummary(cpOf({ measure: "done", target: null }), boxes), null);
  assert.equal(P.progressSummary(cpOf({ measure: undefined }), boxes), null); // 既存データは達成
});

t("測り方を変える：達成にすると目安は消え、時間・回数にすると渡した目安が入る", () => {
  const toDone = P.withMeasure(cpOf(), "done", 5);
  assert.equal(toDone.measure, "done");
  assert.equal(toDone.target, null);
  const toCount = P.withMeasure(cpOf({ measure: "done", target: null }), "count", 3);
  assert.equal(toCount.measure, "count");
  assert.equal(toCount.target, 3);
  // 目安が正しくないなら変えない（空欄の途中で「0回」を保存しない）
  const bad = P.withMeasure(cpOf(), "count", null);
  assert.equal(bad.measure, "time");
  assert.equal(bad.target, 10);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
