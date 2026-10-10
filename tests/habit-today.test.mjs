/**
 * 習慣タブ（/habits）の判断のテスト。
 *
 * 守るもの:
 *   1. 今日の習慣が「残り／記録した／今日は予定なし」のどれか1つに必ず入る
 *   2. 時刻つきの習慣は、記録と時間割の枠が食い違わない
 *      （画面ごとに達成率が変わる事故を作らない）
 */
import assert from "node:assert/strict";
import { logHabitState, splitTodayHabits, cheerFor } from "../src/lib/habit-today.ts";

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

const TODAY = "2026-10-12"; // 月曜
const habit = (over = {}) => ({
  id: "h1",
  cardId: "c1",
  title: "素振り",
  minimalTitle: "10回",
  estimateMin: 30,
  schedule: { kind: "daily" },
  startTime: null,
  where: null,
  cue: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  archivedAt: null,
  ...over,
});
const log = (over = {}) => ({
  habitId: "h1",
  date: TODAY,
  state: "done",
  at: "2026-10-12T03:00:00.000Z",
  note: null,
  mood: null,
  ...over,
});

// ---------------------------------------------------------------- 分け方

t("毎日の習慣で記録が無ければ「残り」", () => {
  const r = splitTodayHabits([habit()], [], TODAY);
  assert.equal(r.open.length, 1);
  assert.equal(r.logged.length, 0);
  assert.equal(r.off.length, 0);
});

t("今日の記録があれば「記録した」（done・partial・missed・skipped すべて）", () => {
  for (const state of ["done", "partial", "missed", "skipped"]) {
    const r = splitTodayHabits([habit()], [log({ state })], TODAY);
    assert.equal(r.logged.length, 1, state);
    assert.equal(r.open.length, 0, state);
  }
});

t("曜日が合わない習慣は「今日は予定なし」", () => {
  const h = habit({ schedule: { kind: "weekdays", days: [2] } }); // 火曜のみ
  const r = splitTodayHabits([h], [], TODAY);
  assert.equal(r.off.length, 1);
  assert.equal(r.open.length, 0);
});

t("予定のない日に記録を付けた習慣は、記録を消さずに「記録した」へ入る", () => {
  const h = habit({ schedule: { kind: "weekdays", days: [2] } });
  const r = splitTodayHabits([h], [log()], TODAY);
  assert.equal(r.logged.length, 1);
  assert.equal(r.off.length, 0);
});

t("週N回は、目安に届いた週の残りの日は「残り」に出さない", () => {
  const h = habit({ schedule: { kind: "timesPerWeek", times: 2 } });
  // 同じ週（10/12 月曜〜）の中で2回済ませた。今日（月曜）の記録は無い想定で別日を使う
  const logs = [log({ date: "2026-10-13" }), log({ date: "2026-10-14" })];
  const r = splitTodayHabits([h], logs, "2026-10-15");
  assert.equal(r.open.length, 0);
  assert.equal(r.off.length, 1);
});

t("畳んだ習慣は出さない", () => {
  const r = splitTodayHabits([habit({ archivedAt: "2026-10-01T00:00:00.000Z" })], [], TODAY);
  assert.equal(r.open.length + r.logged.length + r.off.length, 0);
});

t("どの習慣も、3つのどれか1つにだけ入る", () => {
  const hs = [
    habit({ id: "a" }),
    habit({ id: "b", schedule: { kind: "weekdays", days: [2] } }),
    habit({ id: "c" }),
  ];
  const logs = [log({ habitId: "c" })];
  const r = splitTodayHabits(hs, logs, TODAY);
  assert.equal(r.open.length + r.logged.length + r.off.length, 3);
  assert.deepEqual(r.open.map((x) => x.habit.id), ["a"]);
  assert.deepEqual(r.logged.map((x) => x.habit.id), ["c"]);
  assert.deepEqual(r.off.map((x) => x.habit.id), ["b"]);
});

t("「残り」は時刻の早い順。時刻なしは最後", () => {
  const hs = [
    habit({ id: "n" }),
    habit({ id: "late", startTime: "21:00" }),
    habit({ id: "early", startTime: "07:00" }),
  ];
  const r = splitTodayHabits(hs, [], TODAY);
  assert.deepEqual(r.open.map((x) => x.habit.id), ["early", "late", "n"]);
});

// ---------------------------------------------------------------- 記録の書き方

function deps(initialBoxes = []) {
  const boxes = [...initialBoxes];
  const logs = [];
  return {
    boxes,
    logs,
    upsertTimeBox: (b) => {
      const i = boxes.findIndex((x) => x.id === b.id);
      if (i >= 0) boxes[i] = b;
      else boxes.push(b);
    },
    setHabitLog: (l) => logs.push(l),
    newId: () => "box-real",
    now: () => "2026-10-12T12:00:00.000Z",
  };
}
const timed = (over = {}) => habit({ startTime: "07:00", schedule: { kind: "daily" }, ...over });

t("時刻なしの習慣は、記録だけを書く（枠は作らない）", () => {
  const d = deps();
  logHabitState({ habit: habit(), state: "done", note: null, date: TODAY, existing: [], deps: d });
  assert.equal(d.boxes.length, 0);
  assert.equal(d.logs.length, 1);
  assert.equal(d.logs[0].state, "done");
});

t("時刻つきの習慣の「やった」は、枠を実体にして完了し、同じ時刻で記録する", () => {
  const d = deps();
  logHabitState({ habit: timed(), state: "done", note: null, date: TODAY, existing: [], deps: d });
  assert.equal(d.boxes.length, 1);
  assert.equal(d.boxes[0].id, "box-real");
  assert.equal(d.boxes[0].habitId, "h1");
  assert.equal(d.boxes[0].completedAt, "2026-10-12T12:00:00.000Z");
  assert.equal(d.logs[0].at, d.boxes[0].completedAt, "取り消しは時刻の一致で記録を探す");
});

t("時刻つきの習慣の「最小版」も枠を完了にし、記録は partial", () => {
  const d = deps();
  logHabitState({ habit: timed(), state: "partial", note: null, date: TODAY, existing: [], deps: d });
  assert.ok(d.boxes[0].completedAt);
  assert.equal(d.logs[0].state, "partial");
});

t("すでに完了した枠なら、枠の完了時刻は変えない（メモだけ足せる）", () => {
  const real = {
    id: "box-1",
    date: TODAY,
    start: "07:00",
    end: "07:30",
    title: "素振り",
    habitId: "h1",
    cardId: "c1",
    meta: { why: "", obstacle: "", counter: "" },
    completedAt: "2026-10-12T01:00:00.000Z",
    review: { good: "", bad: "", next: "", score: null },
    createdAt: "2026-10-01T00:00:00.000Z",
  };
  const d = deps([real]);
  logHabitState({ habit: timed(), state: "done", note: "良かった", date: TODAY, existing: [real], deps: d });
  assert.equal(d.boxes[0].completedAt, "2026-10-12T01:00:00.000Z");
  assert.equal(d.logs[0].at, "2026-10-12T01:00:00.000Z");
  assert.equal(d.logs[0].note, "良かった");
});

t("完了した時刻つきの習慣を「できなかった」に変えたら、枠の完了を外す", () => {
  const real = {
    id: "box-1",
    date: TODAY,
    start: "07:00",
    end: "07:30",
    title: "素振り",
    habitId: "h1",
    cardId: "c1",
    meta: { why: "", obstacle: "", counter: "" },
    completedAt: "2026-10-12T01:00:00.000Z",
    review: null,
    createdAt: "2026-10-01T00:00:00.000Z",
  };
  const d = deps([real]);
  logHabitState({ habit: timed(), state: "missed", note: null, date: TODAY, existing: [real], deps: d });
  assert.equal(d.boxes[0].completedAt, null);
  assert.equal(d.logs[0].state, "missed");
});

t("時刻つきでも、今日が置く日でなければ記録だけ（枠を作らない）", () => {
  const h = timed({ schedule: { kind: "weekdays", days: [2] } }); // 火曜のみ
  const d = deps();
  logHabitState({ habit: h, state: "done", note: null, date: TODAY, existing: [], deps: d });
  assert.equal(d.boxes.length, 0);
  assert.equal(d.logs.length, 1);
});

t("「できなかった」「休み」では、枠を新しく作らない", () => {
  const d = deps();
  logHabitState({ habit: timed(), state: "skipped", note: null, date: TODAY, existing: [], deps: d });
  assert.equal(d.boxes.length, 0);
  assert.equal(d.logs[0].state, "skipped");
});

// ---------------------------------------------------------------- 祝いの文言

t("祝いの文言: 連続数が入る。最小版は途切れないと伝える。責める言葉は無い", () => {
  assert.equal(cheerFor("done", { streak: 1, unit: "day" }), "やった！ 今日がはじめの1回");
  assert.equal(cheerFor("done", { streak: 12, unit: "day" }), "やった！ 12日連続");
  assert.equal(cheerFor("done", { streak: 3, unit: "week" }), "やった！ 3週続いています");
  assert.equal(cheerFor("partial", { streak: 5, unit: "day" }), "最小版でも続いています（5日連続）");
  assert.equal(cheerFor("missed", { streak: 5, unit: "day" }), null);
  assert.equal(cheerFor("skipped", { streak: 5, unit: "day" }), null);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
