/**
 * 習慣の集計のテスト。
 *
 * ストリークと達成率は、間違っても画面上は「それらしく」見えてしまう。
 * しかもユーザーから見ると「続いているのに途切れたと言われた」という、
 * いちばん腹の立つ壊れ方をする。ここで数え方を固定しておく。
 */
import assert from "node:assert/strict";
import {
  computeRate,
  computeStats,
  computeStreak,
  heatmap,
  isScheduled,
  scheduleLabel,
  timesPerWeek,
} from "../src/lib/habit.ts";

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

const TODAY = "2026-08-27"; // 木曜
const pad = (n) => String(n).padStart(2, "0");
/** TODAY から n 日前の日付 */
function ago(n) {
  const d = new Date("2026-08-27T00:00:00");
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const habit = (over = {}) => ({
  id: "h1",
  cardId: "c1",
  title: "素振り",
  minimalTitle: "1本だけ振る",
  estimateMin: 20,
  schedule: { kind: "daily" },
  startTime: null,
  where: null,
  cue: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  ...over,
});

const log = (daysAgo, state) => ({
  habitId: "h1",
  date: ago(daysAgo),
  state,
  at: `${ago(daysAgo)}T21:00:00.000Z`,
  note: null,
  mood: null,
});

// ---------------------------------------------------------------- 予定日

t("毎日はすべて予定日", () => {
  assert.equal(isScheduled(habit(), TODAY), true);
  assert.equal(isScheduled(habit(), ago(3)), true);
});

t("曜日指定は該当曜日だけ", () => {
  // 2026-08-27 は木曜（getDay()===4）
  const h = habit({ schedule: { kind: "weekdays", days: [4] } });
  assert.equal(isScheduled(h, TODAY), true);
  assert.equal(isScheduled(h, ago(1)), false, "水曜が予定日になっている");
  assert.equal(isScheduled(h, ago(7)), true, "1週間前の木曜が外れている");
});

t("週N回は曜日を問わないので、常に予定日扱い", () => {
  const h = habit({ schedule: { kind: "timesPerWeek", times: 3 } });
  assert.equal(isScheduled(h, TODAY), true);
  assert.equal(isScheduled(h, ago(1)), true);
});

// ---------------------------------------------------------------- ストリーク

t("連続してやっていれば、その日数だけ数える", () => {
  const logs = [log(0, "done"), log(1, "done"), log(2, "done")];
  assert.equal(computeStreak(habit(), logs, TODAY).streak, 3);
});

t("今日まだやっていなくても、昨日までの連続は途切れない", () => {
  const h = habit({ createdAt: `${ago(3)}T00:00:00.000Z` });
  const logs = [log(1, "done"), log(2, "done")];
  const r = computeStreak(h, logs, TODAY);
  assert.equal(r.streak, 2, "今日の未記録で途切れている");
  assert.equal(r.freezeUsed, false, "今日の未記録に保険を使っている");
});

t("最小版（partial）は途切れとしない", () => {
  const logs = [log(0, "partial"), log(1, "done"), log(2, "partial")];
  assert.equal(computeStreak(habit(), logs, TODAY).streak, 3);
});

t("skipped は飛ばす。失敗にも継続にも数えない", () => {
  const logs = [log(0, "done"), log(1, "skipped"), log(2, "done")];
  assert.equal(computeStreak(habit(), logs, TODAY).streak, 2);
});

t("1日崩れても保険で継続する（what-the-hell 効果を止める）", () => {
  const logs = [log(0, "done"), log(1, "missed"), log(2, "done"), log(3, "done")];
  const r = computeStreak(habit(), logs, TODAY);
  assert.equal(r.streak, 3, "1日の失敗でゼロになっている");
  assert.equal(r.freezeUsed, true);
});

t("保険は1回きり。2回崩れたらそこで切れる", () => {
  const logs = [
    log(0, "done"),
    log(1, "missed"),
    log(2, "done"),
    log(3, "missed"),
    log(4, "done"),
  ];
  assert.equal(computeStreak(habit(), logs, TODAY).streak, 2);
});

t("記録が無い日も missed と同じ扱い（押し忘れも途切れ）", () => {
  const logs = [log(0, "done"), log(2, "done"), log(3, "done")];
  const r = computeStreak(habit(), logs, TODAY);
  assert.equal(r.streak, 3, "抜けた1日を保険で埋められていない");
});

t("古い途切れには保険を使わない（7日より前）", () => {
  const logs = [];
  for (let i = 0; i <= 6; i++) logs.push(log(i, "done"));
  logs.push(log(8, "done")); // 7日前が抜けている
  const r = computeStreak(habit(), logs, TODAY);
  assert.equal(r.streak, 8, "7日前の欠けは保険の範囲内のはず");
});

t("予定日でない日は飛ばして数える", () => {
  // 木曜だけの習慣。今日と1週間前が予定日
  const h = habit({ schedule: { kind: "weekdays", days: [4] } });
  const logs = [log(0, "done"), log(7, "done"), log(14, "done")];
  assert.equal(computeStreak(h, logs, TODAY).streak, 3);
});

t("一度もやっていなければ 0", () => {
  assert.equal(computeStreak(habit(), [], TODAY).streak, 0);
});

// ---------------------------------------------------------------- 達成率

t("全部やっていれば 1.0", () => {
  const h = habit({ createdAt: `${ago(11)}T00:00:00.000Z` });
  const logs = [];
  for (let i = 1; i <= 10; i++) logs.push(log(i, "done"));
  const r = computeRate(h, logs, TODAY);
  assert.equal(r.rate, 1);
  assert.equal(r.scheduled, 10);
});

t("半分なら 0.5", () => {
  const h = habit({ createdAt: `${ago(11)}T00:00:00.000Z` });
  const logs = [];
  for (let i = 1; i <= 10; i++) logs.push(log(i, i % 2 === 0 ? "done" : "missed"));
  assert.equal(computeRate(h, logs, TODAY).rate, 0.5);
});

t("skipped は分母から外す（休むと率が下がるのは理不尽）", () => {
  const h = habit({ createdAt: `${ago(4)}T00:00:00.000Z` });
  const logs = [log(1, "done"), log(2, "skipped"), log(3, "done")];
  const r = computeRate(h, logs, TODAY);
  assert.equal(r.scheduled, 2, "skipped が分母に入っている");
  assert.equal(r.rate, 1);
});

t("今日ぶんは、まだ押していなければ分母に入れない", () => {
  const h = habit({ createdAt: `${ago(2)}T00:00:00.000Z` });
  const logs = [log(1, "done")];
  assert.equal(computeRate(h, logs, TODAY).scheduled, 1);
});

t("今日ぶんも、押していれば数える", () => {
  const h = habit({ createdAt: `${ago(2)}T00:00:00.000Z` });
  const logs = [log(0, "done"), log(1, "done")];
  assert.equal(computeRate(h, logs, TODAY).scheduled, 2);
});

t("始める前の日と作成日そのものは数えない", () => {
  const h = habit({ createdAt: `${ago(2)}T00:00:00.000Z` });
  const logs = [log(1, "done")];
  const r = computeRate(h, logs, TODAY);
  assert.equal(r.scheduled, 1, `作成日まで数えている: ${r.scheduled}`);
  assert.equal(r.rate, 1);
});

t("記録がまったく無ければ 0 を返し、落ちない", () => {
  const h = habit({ createdAt: `${TODAY}T00:00:00.000Z` });
  const r = computeRate(h, [], TODAY);
  assert.equal(r.scheduled, 0);
  assert.equal(r.rate, 0);
});

t("最小版も達成として数える", () => {
  const h = habit({ createdAt: `${ago(3)}T00:00:00.000Z` });
  const logs = [log(1, "partial"), log(2, "done")];
  assert.equal(computeRate(h, logs, TODAY).rate, 1);
});

// ---------------------------------------------------------------- まとめ

t("computeStats は今日の記録と予定を返す", () => {
  const h = habit({ createdAt: `${ago(2)}T00:00:00.000Z` });
  const logs = [log(0, "done"), log(1, "done")];
  const s = computeStats(h, logs, TODAY);
  assert.equal(s.dueToday, true);
  assert.equal(s.todayLog.state, "done");
  assert.equal(s.streak, 2);
  assert.equal(s.freezeLeft, 1);
});

t("保険を使っていれば freezeLeft は 0", () => {
  const h = habit({ createdAt: `${ago(5)}T00:00:00.000Z` });
  const logs = [log(0, "done"), log(1, "missed"), log(2, "done"), log(3, "done"), log(4, "done")];
  assert.equal(computeStats(h, logs, TODAY).freezeLeft, 0);
});

// ---------------------------------------------------------------- ヒートマップ

t("ヒートマップは古い順で、指定日数ぶん返す", () => {
  const cells = heatmap(habit(), [log(0, "done")], 7, TODAY);
  assert.equal(cells.length, 7);
  assert.equal(cells[0].date, ago(6), "先頭が最も古い日ではない");
  assert.equal(cells[6].date, TODAY);
  assert.equal(cells[6].state, "done");
  assert.equal(cells[0].state, null);
});

t("予定日でない日は scheduled=false で返る", () => {
  const h = habit({ schedule: { kind: "weekdays", days: [4] } });
  const cells = heatmap(h, [], 7, TODAY);
  assert.equal(cells.filter((c) => c.scheduled).length, 1, "木曜だけのはず");
});

// ---------------------------------------------------------------- 表示

t("週あたりの回数", () => {
  assert.equal(timesPerWeek(habit()), 7);
  assert.equal(timesPerWeek(habit({ schedule: { kind: "weekdays", days: [1, 3, 5] } })), 3);
  assert.equal(timesPerWeek(habit({ schedule: { kind: "timesPerWeek", times: 2 } })), 2);
});

t("繰り返しの表示", () => {
  assert.equal(scheduleLabel(habit()), "毎日");
  assert.equal(scheduleLabel(habit({ schedule: { kind: "timesPerWeek", times: 3 } })), "週3回");
  assert.equal(
    scheduleLabel(habit({ schedule: { kind: "weekdays", days: [3, 1, 5] } })),
    "月・水・金",
    "曜日が順不同のまま出ている",
  );
  assert.equal(
    scheduleLabel(habit({ schedule: { kind: "weekdays", days: [0, 1, 2, 3, 4, 5, 6] } })),
    "毎日",
  );
  assert.equal(scheduleLabel(habit({ schedule: { kind: "weekdays", days: [] } })), "予定なし");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
