/**
 * 習慣からの自動配置のテスト。
 *
 * ここを間違えると「毎週やることが時間割に出ない」「同じ予定が二重に出る」
 * という形で表面化する。どちらも画面を見ただけでは
 * 「入れ忘れた」のか「出ていない」のか区別がつかない。
 */
import assert from "node:assert/strict";
import {
  canPlace,
  habitBoxId,
  habitBoxesOn,
  isGhost,
  materializeHabitBox,
  placedOn,
} from "../src/lib/habit-plan.ts";

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

const habit = (over = {}) => ({
  id: "h1",
  cardId: "card-1",
  title: "卓球",
  minimalTitle: "",
  estimateMin: 180,
  schedule: { kind: "weekdays", days: [1] }, // 月曜
  startTime: "18:00",
  where: null,
  cue: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  archivedAt: null,
  ...over,
});

const box = (over = {}) => ({
  id: "b1",
  date: "2026-08-31",
  start: "09:00",
  end: "10:00",
  title: "",
  cardId: null,
  meta: { why: "", obstacle: "", counter: "" },
  completedAt: null,
  review: null,
  createdAt: "2026-08-31T00:00:00.000Z",
  ...over,
});

// 2026-08-31 は月曜、09-01 は火曜

// ---------------------------------------------------------------- 置けるか

t("時刻の無い習慣は置けない（何時に並べるか決まらない）", () => {
  assert.equal(canPlace(habit({ startTime: null })), false);
});

t("週◯回は置けない（曜日が決まっていない）", () => {
  assert.equal(canPlace(habit({ schedule: { kind: "timesPerWeek", times: 3 } })), false);
});

t("畳んだ習慣は置かない", () => {
  assert.equal(canPlace(habit({ archivedAt: "2026-08-20T00:00:00.000Z" })), false);
});

t("曜日と時刻がそろっていれば置ける", () => {
  assert.equal(canPlace(habit()), true);
  assert.equal(canPlace(habit({ schedule: { kind: "daily" } })), true);
});

// ---------------------------------------------------------------- どの日に

t("指定した曜日の日にだけ置く", () => {
  const h = habit({ schedule: { kind: "weekdays", days: [1] } });
  assert.equal(placedOn(h, "2026-08-31"), true, "月曜");
  assert.equal(placedOn(h, "2026-09-01"), false, "火曜");
});

t("毎日の習慣はどの日にも置く", () => {
  const h = habit({ schedule: { kind: "daily" } });
  assert.equal(placedOn(h, "2026-08-31"), true);
  assert.equal(placedOn(h, "2026-09-01"), true);
});

// ---------------------------------------------------------------- 枠を起こす

t("習慣から時刻どおりの枠を起こす", () => {
  const r = habitBoxesOn("2026-08-31", [habit()], []);
  assert.equal(r.length, 1);
  assert.equal(r[0].start, "18:00");
  assert.equal(r[0].end, "21:00", "estimateMin 180分ぶん");
  assert.equal(r[0].title, "卓球");
  assert.equal(r[0].cardId, "card-1", "習慣の目標を引き継ぐ");
  assert.equal(r[0].habitId, "h1");
});

t("該当しない曜日には何も起こさない", () => {
  assert.deepEqual(habitBoxesOn("2026-09-01", [habit()], []), []);
});

t("同じ習慣の枠が実体としてある日は、自動配置しない（二重に出さない）", () => {
  const existing = [box({ id: "real", date: "2026-08-31", habitId: "h1" })];
  assert.deepEqual(habitBoxesOn("2026-08-31", [habit()], existing), []);
});

t("実体があるのが別の日なら、その日には出す", () => {
  const existing = [box({ id: "real", date: "2026-09-07", habitId: "h1" })];
  assert.equal(habitBoxesOn("2026-08-31", [habit()], existing).length, 1);
});

t("手で作った枠（habitId なし）は重複判定に影響しない", () => {
  const existing = [box({ id: "manual", date: "2026-08-31", habitId: null })];
  assert.equal(habitBoxesOn("2026-08-31", [habit()], existing).length, 1);
});

t("日をまたがせない。24時で止める", () => {
  const r = habitBoxesOn("2026-08-31", [habit({ startTime: "23:00", estimateMin: 180 })], []);
  assert.equal(r[0].end, "24:00");
});

t("見積もりが0（未設定）なら既定の30分にする", () => {
  const r = habitBoxesOn("2026-08-31", [habit({ estimateMin: 0 })], []);
  assert.equal(r[0].start, "18:00");
  assert.equal(r[0].end, "18:30");
});

t("見積もりが極端に短くても、潰れた枠は作らない", () => {
  // 5分の習慣でも、グリッド上で掴めない高さにはしない
  const r = habitBoxesOn("2026-08-31", [habit({ estimateMin: 5 })], []);
  assert.equal(r[0].end, "18:15");
});

t("開始が早い順に並べる", () => {
  const hs = [
    habit({ id: "late", startTime: "20:00", schedule: { kind: "daily" } }),
    habit({ id: "early", startTime: "07:00", schedule: { kind: "daily" } }),
  ];
  const r = habitBoxesOn("2026-08-31", hs, []);
  assert.deepEqual(
    r.map((b) => b.start),
    ["07:00", "20:00"],
  );
});

// ---------------------------------------------------------------- 実体化

t("自動配置の枠は id で見分けられる", () => {
  const ghost = habitBoxesOn("2026-08-31", [habit()], [])[0];
  assert.equal(isGhost(ghost), true);
  assert.equal(isGhost(box({ id: "0792d509-5022-43f8" })), false);
});

t("同じ習慣・同じ日なら、何度起こしても同じ id になる", () => {
  assert.equal(habitBoxId("h1", "2026-08-31"), habitBoxId("h1", "2026-08-31"));
  assert.notEqual(habitBoxId("h1", "2026-08-31"), habitBoxId("h1", "2026-09-07"));
});

t("実体化しても、どの習慣から来たかは残す", () => {
  const ghost = habitBoxesOn("2026-08-31", [habit()], [])[0];
  const real = materializeHabitBox(ghost, "new-uuid");
  assert.equal(real.id, "new-uuid");
  assert.equal(real.habitId, "h1");
  assert.equal(real.title, "卓球");
  assert.equal(isGhost(real), false, "実体化したら自動配置とは見なさない");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
