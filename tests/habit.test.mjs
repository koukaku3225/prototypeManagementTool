/**
 * 習慣の集計のテスト。
 *
 * ストリークと達成率は、間違っても画面上は「それらしく」見えてしまう。
 * しかもユーザーから見ると「続いているのに途切れたと言われた」という、
 * いちばん腹の立つ壊れ方をする。ここで数え方を固定しておく。
 */
/*
 * 日付の境界を試すので、タイムゾーンを固定する。import より前に置かないと
 * 効かない（date.ts が読み込み時に Date を触るため）。
 * JST を選ぶのは、このアプリが JST 前提で、かつ UTC との差
 * （朝9時までが前日）が実際の不具合として出た側だから。
 */
process.env.TZ = "Asia/Tokyo";

import assert from "node:assert/strict";
import {
  computeRate,
  computeStats,
  computeStreak,
  habitStartDate,
  heatmap,
  isScheduled,
  scheduleLabel,
  timesPerWeek,
} from "../src/lib/habit.ts";
import { daysSinceStart, isWarmingUp } from "../src/lib/habit.ts";

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

/*
 * 保険は「続いているものを1回だけ守る」ためのもの。守る連続が無いときに
 * 消費したことにすると、わたし画面に「0日連続 ・ 保険を使用中」という、
 * 意味の通らない組み合わせが出る（2026-09-20 に実機で確認）。
 */
t("連続が0日なら保険は使ったことにしない", () => {
  const h = habit({ createdAt: `${ago(10)}T00:00:00.000Z` });
  const logs = [log(3, "done")]; // 昨日・一昨日は記録なし
  const r = computeStreak(h, logs, TODAY);
  assert.equal(r.streak, 0);
  assert.equal(r.freezeUsed, false, "連続0日なのに保険が減っている");
  assert.equal(computeStats(h, logs, TODAY).freezeLeft, 1);
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
  assert.equal(r.planned, 10);
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
  assert.equal(r.planned, 2, "skipped が分母に入っている");
  assert.equal(r.rate, 1);
});

t("今日ぶんは、まだ押していなければ分母に入れない", () => {
  const h = habit({ createdAt: `${ago(2)}T00:00:00.000Z` });
  const logs = [log(1, "done")];
  assert.equal(computeRate(h, logs, TODAY).planned, 1);
});

t("今日ぶんも、押していれば数える", () => {
  const h = habit({ createdAt: `${ago(2)}T00:00:00.000Z` });
  const logs = [log(0, "done"), log(1, "done")];
  assert.equal(computeRate(h, logs, TODAY).planned, 2);
});

t("始める前の日と作成日そのものは数えない", () => {
  const h = habit({ createdAt: `${ago(2)}T00:00:00.000Z` });
  const logs = [log(1, "done")];
  const r = computeRate(h, logs, TODAY);
  assert.equal(r.planned, 1, `作成日まで数えている: ${r.planned}`);
  assert.equal(r.rate, 1);
});

t("記録がまったく無ければ 0 を返し、落ちない", () => {
  const h = habit({ createdAt: `${TODAY}T00:00:00.000Z` });
  const r = computeRate(h, [], TODAY);
  assert.equal(r.planned, 0);
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

// ---------------------------------------------- 作成日の扱い（UTC/JST）

/*
 * 2026-09-09 の修正の回帰。
 *
 * createdAt は `toISOString()` の**UTC**文字列。先頭10文字を切り出すと、
 * JST の 00:00〜08:59 に作った習慣は「前日に作った」ことになる。
 * 結果、作った時刻しだいで
 *   - 「はじめて0日目」と「はじめて1日目」がぶれる
 *   - 作成日そのものがストリークと達成率の対象に入ったり入らなかったりする
 * という食い違いが出ていた。瞬間を暦の日に直してから比べる。
 */
t("【回帰】JSTの早朝に作った習慣でも、作成日はその日になる", () => {
  // 2026-08-27 07:00 JST = 2026-08-26T22:00Z。切り出しだと前日になる
  const h = habit({ createdAt: "2026-08-26T22:00:00.000Z" });
  assert.equal(habitStartDate(h), "2026-08-27");
});

t("【回帰】作った当日は0日目（1日目にしない）", () => {
  const h = habit({ createdAt: "2026-08-26T22:00:00.000Z" });
  assert.equal(daysSinceStart(h, TODAY), 0, "作った瞬間に1日目が始まっている");
});

t("作って翌日から1日目", () => {
  const h = habit({ createdAt: "2026-08-25T22:00:00.000Z" }); // 8/26 07:00 JST
  assert.equal(daysSinceStart(h, TODAY), 1);
});

t("【回帰】早朝に作った習慣でも、作成日の前日をストリークに数え込まない", () => {
  // 切り出しのままだと start が前日になり、作る前の日まで数えられてしまう
  const h = habit({ createdAt: "2026-08-26T22:00:00.000Z" }); // 8/27 07:00 JST
  const logs = [log(0, "done"), log(1, "done")];
  assert.equal(computeStreak(h, logs, TODAY).streak, 1, "作る前の日まで数えている");
});

// ------------------------------------ 作成日の「できた」（R2' 案C、2026-09-14）
//
// 作成日は「done / partial の記録があるときだけ」数える。
// 記録が無い・skipped・missed なら、分母にも入れず途切れにもしない
// （夜に作ってその日やらなかった習慣を、いきなり達成率0%にしない）。

t("作った当日に「できた」を押せば、連続1日になる", () => {
  const h = habit({ createdAt: `${TODAY}T01:00:00.000Z` });
  assert.equal(computeStreak(h, [log(0, "done")], TODAY).streak, 1);
});

t("作った当日の最小版（partial）も数える", () => {
  const h = habit({ createdAt: `${TODAY}T01:00:00.000Z` });
  assert.equal(computeStreak(h, [log(0, "partial")], TODAY).streak, 1);
});

t("作成日の done と翌日以降の done がつながる", () => {
  const h = habit({ createdAt: `${ago(2)}T01:00:00.000Z` });
  const r = computeStreak(h, [log(0, "done"), log(1, "done"), log(2, "done")], TODAY);
  assert.equal(r.streak, 3);
  assert.equal(r.freezeUsed, false);
});

t("作成日に記録が無ければ、途切れにも数えず保険も使わない", () => {
  const h = habit({ createdAt: `${ago(2)}T01:00:00.000Z` });
  const r = computeStreak(h, [log(0, "done"), log(1, "done")], TODAY);
  assert.equal(r.streak, 2);
  assert.equal(r.freezeUsed, false, "作成日の未記録で保険が消費されている");
});

t("作成日の skipped / missed は数えず、保険も使わない", () => {
  for (const state of ["skipped", "missed"]) {
    const h = habit({ createdAt: `${ago(1)}T01:00:00.000Z` });
    const r = computeStreak(h, [log(0, "done"), log(1, state)], TODAY);
    assert.equal(r.streak, 1, `${state}`);
    assert.equal(r.freezeUsed, false, `${state} で保険が消費されている`);
  }
});

t("作成日が予定日でなければ、done があっても数えない（ほかの日と同じ）", () => {
  // 木曜だけの習慣を水曜（ago(1)）に作り、その日に押した
  const h = habit({ schedule: { kind: "weekdays", days: [4] }, createdAt: `${ago(1)}T01:00:00.000Z` });
  assert.equal(computeStreak(h, [log(1, "done")], TODAY).streak, 0);
  assert.equal(computeRate(h, [log(1, "done")], TODAY).planned, 0);
});

t("作った当日に押せば、達成率の分母と分子に入る", () => {
  const h = habit({ createdAt: `${TODAY}T01:00:00.000Z` });
  const r = computeRate(h, [log(0, "done")], TODAY);
  assert.equal(r.planned, 1);
  assert.equal(r.rate, 1);
});

t("作成日の done は達成率に入り、未記録の作成日は分母に入らない", () => {
  const withLog = habit({ createdAt: `${ago(2)}T01:00:00.000Z` });
  const a = computeRate(withLog, [log(1, "done"), log(2, "done")], TODAY);
  assert.equal(a.planned, 2);
  assert.equal(a.rate, 1);
  const b = computeRate(withLog, [log(1, "done")], TODAY);
  assert.equal(b.planned, 1, "未記録の作成日が分母に入っている");
  assert.equal(b.rate, 1);
});

t("作成日の missed は分母に入れない（夜に作った日を0%にしない）", () => {
  const h = habit({ createdAt: `${ago(1)}T12:00:00.000Z` });
  const r = computeRate(h, [log(1, "missed")], TODAY);
  assert.equal(r.planned, 0);
  assert.equal(r.rate, 0);
});

t("2週間たつまでは warming up のまま", () => {
  const h = habit({ createdAt: `${ago(13)}T00:00:00.000Z` });
  assert.equal(isWarmingUp(h, TODAY), true);
  const old = habit({ createdAt: `${ago(14)}T00:00:00.000Z` });
  assert.equal(isWarmingUp(old, TODAY), false);
});

// ------------------------------------------------- 週N回（週で数える）

/*
 * 週N回の習慣は「曜日を問わない」ので、日で数えると、きっちり守っていても
 * 予定日が週7日ぶんあることになり、達成率が n/7 に潰れる。
 * 連続も、やらない日が来るたびに途切れる（週3回なら最大2日）。
 * 実際に「毎週きっちり3回を5週」続けた記録で「45% ・ 2日連続」と出ていた。
 * 数える単位を週に変える。
 */

/** 週N回の習慣に、週ごとに n 回の done を w 週ぶん入れる（完了した週から古い順） */
function weeklyLogs(weeks, perWeek) {
  const out = [];
  for (let w = 1; w <= weeks; w++) {
    for (let i = 0; i < perWeek; i++) {
      // TODAY は木曜。ago(4) が先週の日曜なので、そこから週ごとに7日ずつ戻る
      out.push(log(4 + (w - 1) * 7 + i, "done"));
    }
  }
  return out;
}

t("週3回をきっちり3回やっていれば、達成率は100%", () => {
  const h = habit({ schedule: { kind: "timesPerWeek", times: 3 } });
  const r = computeRate(h, weeklyLogs(4, 3), TODAY);
  assert.equal(r.rate, 1, "きっちり守っているのに100%になっていない");
  assert.equal(r.planned, 12, "分母が週の回数（3回×4週）になっていない");
});

t("週3回で4回やった週も、その週ぶんは3回として数える（先取りで水増ししない）", () => {
  const h = habit({ schedule: { kind: "timesPerWeek", times: 3 } });
  const logs = [...weeklyLogs(4, 3), log(7, "done")]; // 先週にもう1回
  const r = computeRate(h, logs, TODAY);
  assert.equal(r.rate, 1);
  assert.equal(r.planned, 12);
});

t("週3回で毎週3回できていれば、連続は週の数で数える", () => {
  const h = habit({ schedule: { kind: "timesPerWeek", times: 3 } });
  const r = computeStreak(h, weeklyLogs(5, 3), TODAY);
  assert.equal(r.streak, 5, "5週続いているのに週で数えていない");
  assert.equal(r.freezeUsed, false, "守れている週に保険を使っている");
});

t("週3回で今週まだ1回でも、先週までの連続は途切れない", () => {
  const h = habit({ schedule: { kind: "timesPerWeek", times: 3 } });
  const logs = [...weeklyLogs(3, 3), log(0, "done")]; // 今週は1回だけ
  assert.equal(computeStreak(h, logs, TODAY).streak, 3);
});

t("週3回で今週すでに3回やっていれば、今週も連続に入る", () => {
  const h = habit({ schedule: { kind: "timesPerWeek", times: 3 } });
  const logs = [...weeklyLogs(2, 3), log(0, "done"), log(1, "done"), log(2, "done")];
  assert.equal(computeStreak(h, logs, TODAY).streak, 3);
});

t("週3回で届かない週が続けば、保険1回ぶんだけ守って途切れる", () => {
  const h = habit({ schedule: { kind: "timesPerWeek", times: 3 } });
  // 先週は1回だけ（未達）、その前の3週はきっちり3回
  const logs = [log(4, "done")];
  for (let w = 2; w <= 4; w++) {
    for (let i = 0; i < 3; i++) logs.push(log(4 + (w - 1) * 7 + i, "done"));
  }
  const r = computeStreak(h, logs, TODAY);
  assert.equal(r.streak, 3, "保険で先週を守ったうえでの連続になっていない");
  assert.equal(r.freezeUsed, true);
});

t("週N回の集計は週単位、それ以外は日単位", () => {
  assert.equal(computeStats(habit(), [], TODAY).unit, "day");
  const h = habit({ schedule: { kind: "timesPerWeek", times: 3 } });
  assert.equal(computeStats(h, [], TODAY).unit, "week");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
