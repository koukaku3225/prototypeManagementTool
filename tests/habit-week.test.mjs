/**
 * 週のふりかえりの判断のテスト。
 *
 * 「できなかった」を責める見せ方にしないこと、未来の週に書かせないこと、
 * 始めたばかりの習慣を率に混ぜないことを固定する。
 */
process.env.TZ = "Asia/Tokyo";

import assert from "node:assert/strict";
import {
  buildWeekSummary,
  canWriteReview,
  mondayOf,
  normalizeReviews,
  parseWeek,
  previousNote,
  reviewOf,
  shiftWeek,
  upsertReview,
  weekDates,
  weekPhase,
  weekRangeLabel,
} from "../src/lib/habit-week.ts";

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

const TODAY = "2026-10-10"; // 土曜。今週は 10/5(月)〜10/11(日)
const THIS = "2026-10-05";
const LAST = "2026-09-28";

const habit = (over = {}) => ({
  id: "h1",
  cardId: "c1",
  title: "素振り",
  minimalTitle: "1本だけ",
  estimateMin: 20,
  schedule: { kind: "daily" },
  startTime: null,
  where: null,
  cue: null,
  createdAt: "2026-08-01T00:00:00.000Z", // 十分前（立ち上がりを過ぎている）
  archivedAt: null,
  ...over,
});
const lg = (date, state, habitId = "h1") => ({
  habitId, date, state, at: `${date}T12:00:00.000Z`, note: null, mood: null,
});
const box = (date, score, over = {}) => ({
  id: `b-${date}-${score}`, date, start: "09:00", end: "10:00", title: "枠", cardId: null,
  meta: { why: "", obstacle: "", counter: "" },
  completedAt: `${date}T01:00:00.000Z`,
  review: { good: "", bad: "", next: "", score },
  createdAt: `${date}T00:00:00.000Z`,
  ...over,
});
const sum = (habits, logs, boxes = [], week = THIS, today = TODAY, opts) =>
  buildWeekSummary(habits, logs, boxes, week, today, opts);

// ---------------------------------------------------------------- 週の範囲
t("月曜始まり: 水曜も日曜も、その週の月曜に丸める", () => {
  assert.equal(mondayOf("2026-10-07"), "2026-10-05");
  assert.equal(mondayOf("2026-10-11"), "2026-10-05"); // 日曜は前の月曜
  assert.equal(mondayOf("2026-10-05"), "2026-10-05");
});

t("月またぎ・年またぎの週", () => {
  assert.deepEqual(weekDates("2026-09-28"), [
    "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
  ]);
  const y = weekDates("2026-12-28");
  assert.equal(y[0], "2026-12-28");
  assert.equal(y[6], "2027-01-03");
  assert.equal(shiftWeek("2026-12-28", 1), "2027-01-04");
  assert.equal(shiftWeek("2027-01-04", -2), "2026-12-21");
});

t("週の見出し: 月またぎ・年またぎ", () => {
  assert.equal(weekRangeLabel("2026-10-05"), "10/5〜10/11");
  assert.equal(weekRangeLabel("2026-09-28"), "9/28〜10/4");
  assert.equal(weekRangeLabel("2026-12-28"), "2026/12/28〜2027/1/3");
});

// ---------------------------------------------------------------- ?w=
t("parseWeek: 月曜でない日付は、その週の月曜に丸める", () => {
  assert.equal(parseWeek("2026-10-08", TODAY), "2026-10-05");
  assert.equal(parseWeek("2026-10-05", TODAY), "2026-10-05");
  assert.equal(parseWeek("2026-09-27", TODAY), "2026-09-21"); // 日曜
});

t("parseWeek: 壊れた値・無い値は今週", () => {
  for (const raw of [null, undefined, "", "abc", "2026-13-01", "2026-02-30", "2026-9-1", "2026-10-05x", "0000-00-00", "1999-01-04", "2101-01-04"]) {
    assert.equal(parseWeek(raw, TODAY), THIS, String(raw));
  }
});

// ---------------------------------------------------------------- 今週・未来週
t("週の段階と、入力できる週", () => {
  assert.equal(weekPhase(LAST, TODAY), "past");
  assert.equal(weekPhase(THIS, TODAY), "current");
  assert.equal(weekPhase("2026-10-12", TODAY), "future");
  assert.equal(canWriteReview(LAST, TODAY), true);
  assert.equal(canWriteReview(THIS, TODAY), true); // 今週は書いてよい
  assert.equal(canWriteReview("2026-10-12", TODAY), false);
});

t("今日が日曜でも、今週は月曜から。翌日の月曜に週が替わる", () => {
  assert.equal(weekPhase(THIS, "2026-10-11"), "current");
  assert.equal(weekPhase(THIS, "2026-10-12"), "past");
});

// ---------------------------------------------------------------- 数字
t("毎日の習慣: 先週（終わった週）は7日が分母。やった＋最小版が分子", () => {
  const logs = [
    lg("2026-09-28", "done"), lg("2026-09-29", "done"), lg("2026-09-30", "partial"),
    lg("2026-10-01", "missed"), lg("2026-10-02", "skipped"),
  ];
  const s = sum([habit()], logs, [], LAST);
  // 休み1日は分母から外れる。10/3,10/4 は記録なしで分母に入る（予定日）
  assert.equal(s.planned, 6);
  assert.equal(s.achieved, 3);
  assert.equal(s.partial, 1);
  assert.equal(s.missed, 1);
  assert.equal(s.skipped, 1);
});

t("今週: 今日の未記録は分母に入れない。まだ来ていない日も入れない", () => {
  const logs = [lg("2026-10-05", "done"), lg("2026-10-06", "done")];
  const s = sum([habit()], logs);
  // 10/5〜10/9 の5日 + 今日(10/10)は未記録なので入れない
  assert.equal(s.planned, 5);
  assert.equal(s.achieved, 2);
});

t("今日の記録があれば分母に入る", () => {
  const s = sum([habit()], [lg(TODAY, "missed")]);
  assert.equal(s.planned, 6);
  assert.equal(s.missed, 1);
});

t("曜日指定: 予定日だけが分母。予定外の日の記録は回数に入るが率の分子には入れない", () => {
  const h = habit({ schedule: { kind: "weekdays", days: [1, 3] } }); // 月・水
  const logs = [lg("2026-10-05", "done"), lg("2026-10-06", "done") /* 火＝予定外 */];
  const s = sum([h], logs);
  assert.equal(s.planned, 2); // 月・水
  assert.equal(s.achieved, 1);
  assert.equal(s.extra, 1);
  assert.equal(s.kept, 2);
});

t("週N回: 週の目安が分母。1週の分子は目安で頭打ち", () => {
  const h = habit({ schedule: { kind: "timesPerWeek", times: 3 } });
  const four = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"].map((d) => lg(d, "done"));
  const s = sum([h], four, [], LAST);
  assert.equal(s.planned, 3);
  assert.equal(s.achieved, 3);
  assert.equal(s.kept, 4);
  const two = sum([h], four.slice(0, 2), [], LAST);
  assert.equal(two.planned, 3);
  assert.equal(two.achieved, 2);
});

t("週N回: 作った週は率に入れない（途中から始まっているので）", () => {
  const h = habit({ schedule: { kind: "timesPerWeek", times: 3 }, createdAt: "2026-10-06T00:00:00.000Z" });
  const s = sum([h], [lg("2026-10-07", "done")]);
  assert.equal(s.planned, 0);
  assert.equal(s.achieved, 0);
  assert.equal(s.kept, 1); // 回数としては数える
});

t("作った週の習慣は立ち上がり中なので率に入れない。作る前の日の記録も回数には数える", () => {
  const h = habit({ createdAt: "2026-10-07T00:00:00.000Z" }); // 水曜に作成
  const s = sum([h], [lg("2026-10-07", "done")]);
  assert.equal(s.planned, 0);
  assert.equal(s.warmingUpCount, 1);
  assert.equal(s.kept, 1);
  // 数週間たってから過去の週を開いても、その週の終わり時点で判断する（今日で見ない）
  const later = sum([h], [lg("2026-10-07", "done")], [], THIS, "2026-12-01");
  assert.equal(later.warmingUpCount, 1);
  assert.equal(later.planned, 0);
});

t("作る前の週は習慣を数えない", () => {
  const h = habit({ createdAt: "2026-10-01T00:00:00.000Z" });
  const s = sum([h], [], [], LAST); // 9/28〜10/4 の中の 10/1 に作成
  assert.equal(s.habitCount, 1);
  const before = sum([h], [], [], "2026-09-21");
  assert.equal(before.habitCount, 0);
  assert.equal(before.planned, 0);
});

t("畳んだ習慣: その週に記録があるときだけ数え、畳んだ日より後は分母に入れない", () => {
  const h = habit({ archivedAt: "2026-10-07T03:00:00.000Z" }); // 水曜に畳んだ
  const s = sum([h], [lg("2026-10-05", "done"), lg("2026-10-06", "done")]);
  assert.equal(s.habitCount, 1);
  assert.equal(s.planned, 3); // 月・火・水
  const none = sum([h], [], [], "2026-10-12", "2026-10-20");
  assert.equal(none.habitCount, 0);
  const noLog = sum([habit({ archivedAt: "2026-09-01T00:00:00.000Z" })], []);
  assert.equal(noLog.habitCount, 0);
});

t("完了した目標の習慣（retiredIds）は記録のある週だけ", () => {
  const retired = new Set(["h1"]);
  assert.equal(sum([habit()], [], [], THIS, TODAY, { retiredIds: retired }).habitCount, 0);
  assert.equal(sum([habit()], [lg("2026-10-05", "done")], [], THIS, TODAY, { retiredIds: retired }).habitCount, 1);
});

t("立ち上がり14日の習慣は率に混ぜない。ただし事実の回数（最小版・できなかった）は数える", () => {
  const warm = habit({ id: "w", createdAt: "2026-10-01T00:00:00.000Z" }); // 9日目
  const old = habit({ id: "o" });
  const logs = [
    lg("2026-10-05", "done", "o"), lg("2026-10-06", "done", "o"),
    lg("2026-10-05", "partial", "w"), lg("2026-10-06", "missed", "w"),
  ];
  const s = sum([warm, old], logs);
  assert.equal(s.warmingUpCount, 1);
  assert.equal(s.planned, 5); // 古い習慣の5日だけ
  assert.equal(s.achieved, 2);
  assert.equal(s.partial, 1);
  assert.equal(s.missed, 1);
});

t("分母が0のとき率は null（0%と出さない）", () => {
  const s = sum([habit()], [], [], "2026-10-12", TODAY);
  assert.equal(s.rate, null);
  assert.equal(s.planned, 0);
});

t("率: 分子/分母", () => {
  const s = sum([habit()], [lg("2026-10-05", "done"), lg("2026-10-06", "done")]);
  assert.equal(s.rate, 2 / 5);
});

// ---------------------------------------------------------------- できばえ
t("できばえ平均: スコアの入っている枠だけの平均。1件も無ければ null", () => {
  const none = sum([], [], [box("2026-10-06", null), box("2026-10-07", null, { review: null })]);
  assert.equal(none.scoreAvg, null);
  assert.equal(none.scoreCount, 0);
  const some = sum([], [], [box("2026-10-06", 80), box("2026-10-07", 60), box("2026-10-08", null)]);
  assert.equal(some.scoreAvg, 70);
  assert.equal(some.scoreCount, 2);
});

t("できばえ平均: 週の外の枠は入れない。0点は入る。壊れた値は捨てる", () => {
  const s = sum([], [], [
    box("2026-10-04", 100), // 前の週の日曜
    box("2026-10-12", 100), // 次の週の月曜
    box("2026-10-05", 0),
    box("2026-10-11", 100),
    box("2026-10-06", "90"),
    box("2026-10-06", Number.NaN),
    box("2026-10-06", 999),
  ]);
  assert.equal(s.scoreCount, 2);
  assert.equal(s.scoreAvg, 50);
});

t("できばえ平均は整数に丸める", () => {
  const s = sum([], [], [box("2026-10-05", 70), box("2026-10-06", 71), box("2026-10-07", 71)]);
  assert.equal(s.scoreAvg, 71); // 70.67
});

// ---------------------------------------------------------------- 前回の自分から
const rv = (weekStart, good = "", nextNote = "", updatedAt = "2026-10-01T00:00:00.000Z") => ({
  weekStart, good, nextNote, updatedAt,
});

t("前回の自分から: 直前の週の「来週の自分へ」を返す", () => {
  const reviews = [rv(LAST, "良", "朝にやる"), rv("2026-09-21", "", "もっと前")];
  assert.equal(previousNote(reviews, THIS), "朝にやる");
});

t("前回の自分から: 直前の週に無い・空なら null（もっと前の週は出さない）", () => {
  assert.equal(previousNote([rv("2026-09-21", "", "もっと前")], THIS), null);
  assert.equal(previousNote([rv(LAST, "良い", "")], THIS), null);
  assert.equal(previousNote([], THIS), null);
  assert.equal(previousNote([rv(LAST, "", "   ")], THIS), null);
});

t("前回の自分から: 年またぎ", () => {
  assert.equal(previousNote([rv("2026-12-28", "", "年末の自分")], "2027-01-04"), "年末の自分");
});

t("reviewOf: 週で引く", () => {
  assert.equal(reviewOf([rv(THIS, "a", "b")], THIS)?.good, "a");
  assert.equal(reviewOf([rv(THIS, "a", "b")], LAST), null);
});

// ---------------------------------------------------------------- 保存
t("upsertReview: 新規・上書き（同じ週は1行）", () => {
  const a = upsertReview([], THIS, "良かった", "", "2026-10-10T00:00:00.000Z");
  assert.equal(a.length, 1);
  assert.deepEqual(a[0], { weekStart: THIS, good: "良かった", nextNote: "", updatedAt: "2026-10-10T00:00:00.000Z" });
  const b = upsertReview(a, THIS, "良かった", "朝に", "2026-10-11T00:00:00.000Z");
  assert.equal(b.length, 1);
  assert.equal(b[0].nextNote, "朝に");
  assert.equal(b[0].updatedAt, "2026-10-11T00:00:00.000Z");
});

t("upsertReview: 2欄とも空なら行を消す。ほかの週は残す", () => {
  const base = [rv(LAST, "x", "y"), rv(THIS, "a", "")];
  const out = upsertReview(base, THIS, "  ", "", "2026-10-10T00:00:00.000Z");
  assert.deepEqual(out.map((r) => r.weekStart), [LAST]);
  assert.equal(base.length, 2); // 元の配列は変えない
});

t("upsertReview: 空の行を新しく作らない", () => {
  assert.deepEqual(upsertReview([], THIS, "", "", "2026-10-10T00:00:00.000Z"), []);
});

t("upsertReview: 月曜でない日付は月曜に丸めて保存（週で一意）", () => {
  const out = upsertReview([], "2026-10-08", "a", "", "2026-10-10T00:00:00.000Z");
  assert.equal(out[0].weekStart, THIS);
});

t("upsertReview: 長すぎる文は切る", () => {
  const out = upsertReview([], THIS, "あ".repeat(5000), "", "2026-10-10T00:00:00.000Z");
  assert.ok(out[0].good.length <= 1000);
});

t("normalizeReviews: 壊れた行を捨て、同じ週は新しいほうを残す", () => {
  const out = normalizeReviews([
    rv(THIS, "古", "", "2026-10-01T00:00:00.000Z"),
    rv(THIS, "新", "", "2026-10-09T00:00:00.000Z"),
    { weekStart: "bad", good: "x", nextNote: "", updatedAt: "" },
    { weekStart: "2026-10-06", good: "月曜でない", nextNote: "", updatedAt: "" },
    { weekStart: LAST, good: 5, nextNote: null },
    null,
    "str",
    rv(LAST, "", "", ""), // 空
  ]);
  assert.deepEqual(out.map((r) => [r.weekStart, r.good]), [[THIS, "新"]]);
  assert.deepEqual(normalizeReviews(null), []);
  assert.deepEqual(normalizeReviews({}), []);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
