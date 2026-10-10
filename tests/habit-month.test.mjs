/**
 * 月の見開き（習慣×日付のマス目）の判断のテスト。
 *
 * 見るだけの画面なので、間違えても保存データは壊れない。ただし「続けているのに
 * 空欄に見える」「作る前の日が"できなかった"に見える」は本人を責める壊れ方になる。
 * マスの種別の決め方をここで固定する。
 */
process.env.TZ = "Asia/Tokyo";

import assert from "node:assert/strict";
import {
  buildMonthGrid,
  daysInMonth,
  groupRowsByCard,
  monthLabel,
  monthOf,
  parseMonth,
  shiftMonth,
} from "../src/lib/habit-month.ts";

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

const TODAY = "2026-10-10"; // 土曜
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
  // 作成日は 2026-09-01（JST）
  createdAt: "2026-09-01T00:00:00.000Z",
  archivedAt: null,
  ...over,
});
const lg = (date, state, habitId = "h1") => ({
  habitId,
  date,
  state,
  at: `${date}T12:00:00.000Z`,
  note: null,
  mood: null,
});
const grid = (habits, logs, month = "2026-10", today = TODAY, opts) =>
  buildMonthGrid(habits, logs, month, today, opts);
const cellAt = (g, row, date) => g.rows[row].cells.find((c) => c.date === date);
const kindAt = (g, row, date) => cellAt(g, row, date).kind;

// ---------------------------------------------------------------- 月の日数
t("月の日数: 28/29/30/31 とうるう年", () => {
  assert.equal(daysInMonth("2026-02"), 28);
  assert.equal(daysInMonth("2028-02"), 29);
  assert.equal(daysInMonth("2100-02"), 28); // 100年は閉じる
  assert.equal(daysInMonth("2000-02"), 29); // 400年は開く
  assert.equal(daysInMonth("2026-04"), 30);
  assert.equal(daysInMonth("2026-10"), 31);
});

t("列の数が月ごとに変わる", () => {
  assert.equal(grid([habit()], [], "2026-02").days.length, 28);
  assert.equal(grid([habit()], [], "2028-02").days.length, 29);
  assert.equal(grid([habit()], [], "2026-09").days.length, 30);
  assert.equal(grid([habit()], [], "2026-10").days.length, 31);
  assert.equal(grid([habit()], [], "2026-10").rows[0].cells.length, 31);
});

t("日の列: 曜日と今日の印。1日は木曜", () => {
  const g = grid([habit()], []);
  assert.equal(g.days[0].date, "2026-10-01");
  assert.equal(g.days[0].dow, 4); // 木
  assert.equal(g.days[30].date, "2026-10-31");
  assert.equal(g.days.filter((d) => d.isToday).length, 1);
  assert.equal(g.days.find((d) => d.isToday).date, TODAY);
});

// ---------------------------------------------------------------- 月の読み取りと移動
t("月の指定: 不正な値は fallback に倒す", () => {
  assert.equal(parseMonth("2026-09", "2026-10"), "2026-09");
  assert.equal(parseMonth("abc", "2026-10"), "2026-10");
  assert.equal(parseMonth("2026-13", "2026-10"), "2026-10");
  assert.equal(parseMonth("2026-00", "2026-10"), "2026-10");
  assert.equal(parseMonth("2026-9", "2026-10"), "2026-10");
  assert.equal(parseMonth("", "2026-10"), "2026-10");
  assert.equal(parseMonth(null, "2026-10"), "2026-10");
  assert.equal(parseMonth(undefined, "2026-10"), "2026-10");
  assert.equal(parseMonth("2026-10-05", "2026-10"), "2026-10");
  assert.equal(parseMonth("0001-01", "2026-10"), "2026-10");
  assert.equal(parseMonth("9999-12", "2026-10"), "2026-10");
});

t("月の移動: 年またぎ", () => {
  assert.equal(shiftMonth("2026-10", -1), "2026-09");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-10", 0), "2026-10");
  assert.equal(shiftMonth("2026-03", -14), "2025-01");
});

t("月の取り出しとラベル", () => {
  assert.equal(monthOf("2026-10-10"), "2026-10");
  assert.equal(monthLabel("2026-10"), "2026年10月");
  assert.equal(monthLabel("2026-01"), "2026年1月");
});

// ---------------------------------------------------------------- マスの種別
t("記録のあるマスは、記録の状態がそのまま種別になる", () => {
  const g = grid(
    [habit()],
    [
      lg("2026-10-01", "done"),
      lg("2026-10-02", "partial"),
      lg("2026-10-03", "missed"),
      lg("2026-10-04", "skipped"),
    ],
  );
  assert.equal(kindAt(g, 0, "2026-10-01"), "done");
  assert.equal(kindAt(g, 0, "2026-10-02"), "partial");
  assert.equal(kindAt(g, 0, "2026-10-03"), "missed");
  assert.equal(kindAt(g, 0, "2026-10-04"), "skipped");
});

t("予定日で過去・記録なしは「未記録」。今日は「これから」、明日以降は「未来」", () => {
  const g = grid([habit()], [lg("2026-10-01", "done")]);
  assert.equal(kindAt(g, 0, "2026-10-05"), "unrecorded");
  assert.equal(kindAt(g, 0, "2026-10-09"), "unrecorded");
  assert.equal(kindAt(g, 0, TODAY), "open");
  assert.equal(kindAt(g, 0, "2026-10-11"), "future");
  assert.equal(kindAt(g, 0, "2026-10-31"), "future");
});

t("今日すでに記録したマスは「これから」ではなく記録の状態", () => {
  const g = grid([habit()], [lg(TODAY, "done")]);
  assert.equal(kindAt(g, 0, TODAY), "done");
});

t("曜日指定: 予定のない曜日は「予定のない日」。予定外の記録は出す（印つき）", () => {
  // 月・水・金。10/1(木) は予定外
  const h = habit({ schedule: { kind: "weekdays", days: [1, 3, 5] } });
  const g = grid([h], [lg("2026-10-01", "done"), lg("2026-10-05", "done")]);
  assert.equal(kindAt(g, 0, "2026-10-02"), "unrecorded"); // 金
  assert.equal(kindAt(g, 0, "2026-10-03"), "off"); // 土
  assert.equal(kindAt(g, 0, "2026-10-01"), "done"); // 予定外でも塗る
  assert.equal(cellAt(g, 0, "2026-10-01").extra, true);
  assert.equal(cellAt(g, 0, "2026-10-05").extra, false);
});

t("週N回: 曜日を決めないので、やった日だけ塗り、ほかは「予定のない日」扱いにしない", () => {
  const h = habit({ schedule: { kind: "timesPerWeek", times: 3 } });
  const g = grid([h], [lg("2026-10-02", "done"), lg("2026-10-06", "partial")]);
  assert.equal(kindAt(g, 0, "2026-10-02"), "done");
  assert.equal(kindAt(g, 0, "2026-10-06"), "partial");
  assert.equal(kindAt(g, 0, "2026-10-03"), "none"); // off でも unrecorded でもない
  assert.equal(kindAt(g, 0, "2026-10-08"), "none");
  assert.equal(kindAt(g, 0, TODAY), "none");
  assert.equal(kindAt(g, 0, "2026-10-20"), "future");
  // 週N回に「予定外」は無い
  assert.equal(cellAt(g, 0, "2026-10-02").extra, false);
});

t("作る前の日は「作る前」。作成日はローカル日付で決める（UTC の日付ではない）", () => {
  // UTC 2026-10-04 20:00 = JST 2026-10-05 05:00。作成日は 10/5
  const h = habit({ createdAt: "2026-10-04T20:00:00.000Z" });
  const g = grid([h], []);
  assert.equal(kindAt(g, 0, "2026-10-04"), "before");
  assert.equal(kindAt(g, 0, "2026-10-05"), "unrecorded");
  assert.equal(kindAt(g, 0, "2026-10-01"), "before");
});

t("作る前でも記録があれば、記録を出す（見えなくしない）", () => {
  const h = habit({ createdAt: "2026-10-05T00:00:00.000Z" });
  const g = grid([h], [lg("2026-10-03", "done")]);
  assert.equal(kindAt(g, 0, "2026-10-03"), "done");
});

t("未来でも記録があれば、記録を出す", () => {
  const g = grid([habit()], [lg("2026-10-12", "done")]);
  assert.equal(kindAt(g, 0, "2026-10-12"), "done");
});

t("ほかの習慣の記録は混ざらない", () => {
  const g = grid([habit({ id: "h1" })], [lg("2026-10-02", "done", "h2")]);
  assert.equal(kindAt(g, 0, "2026-10-02"), "unrecorded");
});

t("月またぎ: 別の月の記録は出さない。前月の月末は前月に出る", () => {
  const logs = [lg("2026-09-30", "done"), lg("2026-10-01", "done"), lg("2026-11-01", "done")];
  const oct = grid([habit()], logs, "2026-10");
  assert.equal(oct.rows[0].cells.length, 31);
  assert.equal(oct.rows[0].stats.kept, 1);
  const sep = grid([habit()], logs, "2026-09");
  assert.equal(kindAt(sep, 0, "2026-09-30"), "done");
  assert.equal(sep.rows[0].stats.kept, 1);
});

t("未来の月は、全部「未来」で記録は無い", () => {
  const g = grid([habit()], [], "2026-12");
  assert.ok(g.rows[0].cells.every((c) => c.kind === "future"));
});

// ---------------------------------------------------------------- アーカイブ
t("畳んだ習慣: その月に記録が無ければ出さない", () => {
  const h = habit({ archivedAt: "2026-09-20T00:00:00.000Z" });
  assert.equal(grid([h], [], "2026-10").rows.length, 0);
});

t("畳んだ習慣: その月に記録があれば出す。やめたあとの日は「やめたあと」", () => {
  const h = habit({ archivedAt: "2026-10-05T03:00:00.000Z" }); // JST 10/5 12:00
  const g = grid([h], [lg("2026-10-02", "done")], "2026-10");
  assert.equal(g.rows.length, 1);
  assert.equal(g.rows[0].archived, true);
  assert.equal(kindAt(g, 0, "2026-10-02"), "done");
  assert.equal(kindAt(g, 0, "2026-10-05"), "unrecorded"); // 畳んだ当日までは対象
  assert.equal(kindAt(g, 0, "2026-10-06"), "after");
});

t("畳んだ習慣: 畳む前の月に記録があれば、その月は出す", () => {
  const h = habit({ archivedAt: "2026-10-05T03:00:00.000Z" });
  const g = grid([h], [lg("2026-09-10", "done")], "2026-09");
  assert.equal(g.rows.length, 1);
  assert.equal(kindAt(g, 0, "2026-09-11"), "unrecorded");
});

t("畳んでいないが、完了した目標の習慣（retiredIds）も同じ扱い", () => {
  const h = habit();
  const none = grid([h], [], "2026-10", TODAY, { retiredIds: new Set(["h1"]) });
  assert.equal(none.rows.length, 0);
  const some = grid([h], [lg("2026-10-02", "done")], "2026-10", TODAY, {
    retiredIds: new Set(["h1"]),
  });
  assert.equal(some.rows.length, 1);
  assert.equal(some.rows[0].archived, true);
  // 畳んだわけではないので、日付で「やめたあと」にはしない
  assert.equal(kindAt(some, 0, "2026-10-06"), "unrecorded");
});

t("作る前の月（記録も無い）の習慣は出さない", () => {
  const h = habit({ createdAt: "2026-10-05T00:00:00.000Z" });
  assert.equal(grid([h], [], "2026-09").rows.length, 0);
});

// ---------------------------------------------------------------- 要約
t("要約: 毎日の習慣。やった/最小版を数え、率は予定日が分母。休みは分母から外す", () => {
  const logs = [
    lg("2026-10-01", "done"),
    lg("2026-10-02", "done"),
    lg("2026-10-03", "partial"),
    lg("2026-10-04", "missed"),
    lg("2026-10-05", "skipped"),
  ];
  const s = grid([habit()], logs).rows[0].stats;
  assert.equal(s.kept, 3);
  assert.equal(s.done, 2);
  assert.equal(s.partial, 1);
  assert.equal(s.planned, 8); // 10/1〜10/9 の9日 - 休み1。今日は未記録なので入れない
  assert.equal(s.rate, 3 / 8);
  assert.equal(s.unit, "day");
  assert.equal(s.warmingUp, false);
});

t("要約: 今日記録済みなら今日も分母に入る", () => {
  const s = grid([habit()], [lg(TODAY, "done")]).rows[0].stats;
  assert.equal(s.planned, 10);
  assert.equal(s.rate, 1 / 10);
});

t("要約: 予定外の記録は「やった回数」に入るが、率の分子には入れない（100%超を防ぐ）", () => {
  const h = habit({ schedule: { kind: "weekdays", days: [1, 3, 5] } });
  const logs = [lg("2026-10-01", "done"), lg("2026-10-02", "done")]; // 木=予定外, 金=予定
  const s = grid([h], logs).rows[0].stats;
  assert.equal(s.kept, 2);
  // 予定日: 10/2(金) 10/5(月) 10/7(水) 10/9(金) = 4日、達成1
  assert.equal(s.planned, 4);
  assert.equal(s.rate, 1 / 4);
});

t("要約: 作成日は、やった記録があるときだけ分母に入れる（habit.ts と同じ約束）", () => {
  const h = habit({ createdAt: "2026-10-05T00:00:00.000Z" });
  const none = grid([h], []).rows[0].stats;
  assert.equal(none.planned, 4); // 10/6〜10/9
  const did = grid([h], [lg("2026-10-05", "done")]).rows[0].stats;
  assert.equal(did.planned, 5);
  assert.equal(did.kept, 1);
});

t("要約: 立ち上がり14日の習慣は率を出さない（回数は出す）", () => {
  const h = habit({ createdAt: "2026-10-01T00:00:00.000Z" }); // 今日で9日目
  const s = grid([h], [lg("2026-10-01", "done"), lg("2026-10-02", "done")]).rows[0].stats;
  assert.equal(s.warmingUp, true);
  assert.equal(s.rate, null);
  assert.equal(s.kept, 2);
});

t("要約: 過去の月は、その月の終わり時点で立ち上がりを判断する", () => {
  const h = habit({ createdAt: "2026-09-25T00:00:00.000Z" });
  const sep = grid([h], [lg("2026-09-26", "done")], "2026-09").rows[0].stats;
  assert.equal(sep.warmingUp, true);
  assert.equal(sep.rate, null);
  const oct = grid([h], [], "2026-10").rows[0].stats;
  assert.equal(oct.warmingUp, false);
  assert.notEqual(oct.rate, null);
});

t("要約: 週N回は、月に丸ごと収まる終わった週だけで率を出す。週の目安で頭打ち", () => {
  const h = habit({
    schedule: { kind: "timesPerWeek", times: 3 },
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  // 9月の完全な週: 9/7-9/13, 9/14-9/20, 9/21-9/27（9/28-10/4 は月をまたぐ）。9/1-9/6 も月初で欠ける
  const logs = [
    lg("2026-09-07", "done"),
    lg("2026-09-08", "done"),
    lg("2026-09-09", "done"),
    lg("2026-09-10", "done"), // 目安3を超えた分は率に入れない
    lg("2026-09-14", "done"),
    lg("2026-09-21", "partial"),
    lg("2026-09-22", "done"),
    lg("2026-09-28", "done"), // 月内だが完全な週に入らない。回数には入る
  ];
  const s = grid([h], logs, "2026-09").rows[0].stats;
  assert.equal(s.unit, "week");
  assert.equal(s.kept, 8);
  assert.equal(s.weeks, 3);
  assert.equal(s.planned, 9);
  assert.equal(s.rate, (3 + 1 + 2) / 9);
});

t("要約: 週N回で、月に丸ごと収まる終わった週が無ければ率は null（回数だけ）", () => {
  const h = habit({
    schedule: { kind: "timesPerWeek", times: 3 },
    createdAt: "2026-08-01T00:00:00.000Z",
  });
  // 今日 10/10。10/5-10/11 は未完、以降は未来。10/1-10/4 は月初で欠ける
  const s = grid([h], [lg("2026-10-02", "done")], "2026-10").rows[0].stats;
  assert.equal(s.weeks, 0);
  assert.equal(s.rate, null);
  assert.equal(s.kept, 1);
});

t("要約: 週N回で、作った週は分母に入れない", () => {
  const h = habit({
    schedule: { kind: "timesPerWeek", times: 2 },
    createdAt: "2026-09-09T00:00:00.000Z", // 水。作った週は 9/7-9/13
  });
  const s = grid([h], [], "2026-09").rows[0].stats;
  assert.equal(s.weeks, 2); // 9/14-20, 9/21-27
  assert.equal(s.planned, 4);
});

t("要約: 予定も記録も無い月でも落ちない（0除算なし）", () => {
  const h = habit({ createdAt: "2026-08-01T00:00:00.000Z" });
  const s = grid([h], [lg("2026-10-02", "skipped")], "2026-10").rows[0].stats;
  assert.equal(s.kept, 0);
  assert.ok(Number.isFinite(s.rate));
  const f = grid([h], [], "2026-12").rows[0].stats;
  assert.equal(f.planned, 0);
  assert.equal(f.rate, null);
});

// ---------------------------------------------------------------- 並べ方
t("目標ごとのまとまり: 目標の並び順に従い、習慣は作成順。未知の目標は最後にまとめる", () => {
  const hs = [
    habit({ id: "a", cardId: "c2", title: "A", createdAt: "2026-09-02T00:00:00.000Z" }),
    habit({ id: "b", cardId: "c1", title: "B", createdAt: "2026-09-03T00:00:00.000Z" }),
    habit({ id: "c", cardId: "c2", title: "C", createdAt: "2026-09-01T00:00:00.000Z" }),
    habit({ id: "d", cardId: "gone", title: "D", createdAt: "2026-09-01T00:00:00.000Z" }),
  ];
  const g = grid(hs, []);
  const groups = groupRowsByCard(g.rows, ["c1", "c2"]);
  assert.deepEqual(
    groups.map((x) => x.cardId),
    ["c1", "c2", "gone"],
  );
  assert.deepEqual(
    groups[1].rows.map((r) => r.habit.id),
    ["c", "a"],
  );
});

t("習慣が0件でも落ちない", () => {
  const g = grid([], []);
  assert.equal(g.rows.length, 0);
  assert.equal(g.days.length, 31);
  assert.deepEqual(groupRowsByCard(g.rows, []), []);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
