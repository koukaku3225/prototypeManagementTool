/**
 * 本物の予定を「重ねて表示する」ためのデータ作りを固定する。
 *
 * ここが緩いと、アプリが作った予定が二重に見えたり、
 * 日をまたぐ予定が落ちて「空いている」ように見えて予定を入れてしまう。
 * どちらも、空き時間を判断するという目的をそのまま壊す。
 * 実行は `npm test`。
 */
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { buildOverlay } from "../src/lib/calendar/overlay.ts";
import { fromRfc3339 } from "../src/lib/calendar/engine.ts";

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}

const DAY = "2026-09-07";

/** 時刻つきの予定を作る */
function ev(startIso, endIso, over = {}) {
  return {
    status: "confirmed",
    summary: "打ち合わせ",
    start: { dateTime: startIso },
    end: { dateTime: endIso },
    ...over,
  };
}

const build = (events, date = DAY) =>
  buildOverlay({ events, calendarName: "メイン", date, parse: fromRfc3339 });

// ---------------------------------------------------------------- 基本

t("その日の予定を時刻つきで返す", () => {
  const r = build([ev(`${DAY}T09:00:00+09:00`, `${DAY}T10:00:00+09:00`)]);
  assert.deepEqual(r, [
    { title: "打ち合わせ", date: DAY, start: "09:00", end: "10:00", calendarName: "メイン" },
  ]);
});

t("タイトルが空なら代わりの文言を出す", () => {
  const r = build([ev(`${DAY}T09:00:00+09:00`, `${DAY}T10:00:00+09:00`, { summary: "  " })]);
  assert.equal(r[0].title, "（タイトルなし）");
});

t("早い順に並ぶ", () => {
  const r = build([
    ev(`${DAY}T15:00:00+09:00`, `${DAY}T16:00:00+09:00`, { summary: "後" }),
    ev(`${DAY}T09:00:00+09:00`, `${DAY}T10:00:00+09:00`, { summary: "先" }),
  ]);
  assert.deepEqual(r.map((x) => x.title), ["先", "後"]);
});

// ---------------------------------------------------------------- 落とすもの

t("削除済みは出さない", () => {
  assert.equal(
    build([ev(`${DAY}T09:00:00+09:00`, `${DAY}T10:00:00+09:00`, { status: "cancelled" })]).length,
    0,
  );
});

t("【回帰】アプリが作った予定は重ねない（二重に見える）", () => {
  // 専用カレンダーの予定は既に本体の枠として描かれている
  const r = build([
    ev(`${DAY}T09:00:00+09:00`, `${DAY}T10:00:00+09:00`, {
      extendedProperties: { private: { timeboxId: "box1" } },
    }),
  ]);
  assert.equal(r.length, 0);
});

t("終日予定は出さない（時刻を持たない）", () => {
  const r = build([
    { status: "confirmed", summary: "祝日", start: { date: DAY }, end: { date: DAY } },
  ]);
  assert.equal(r.length, 0);
});

t("別の日の予定は出さない", () => {
  const r = build([ev("2026-09-01T09:00:00+09:00", "2026-09-01T10:00:00+09:00")]);
  assert.equal(r.length, 0);
});

// ---------------------------------------------------------------- 日をまたぐ

t("【回帰】前日から続く予定は 00:00 から埋める", () => {
  // 落とすと、朝が空いているように見えて予定を入れてしまう
  const r = build([ev("2026-09-06T22:00:00+09:00", `${DAY}T02:00:00+09:00`)]);
  assert.equal(r.length, 1);
  assert.equal(r[0].start, "00:00");
  assert.equal(r[0].end, "02:00");
});

t("【回帰】翌日へ続く予定は 24:00 まで埋める", () => {
  const r = build([ev(`${DAY}T22:00:00+09:00`, "2026-09-08T02:00:00+09:00")]);
  assert.equal(r.length, 1);
  assert.equal(r[0].start, "22:00");
  assert.equal(r[0].end, "24:00");
});

t("その日を丸ごと覆う予定は 00:00〜24:00 になる", () => {
  const r = build([ev("2026-09-05T10:00:00+09:00", "2026-09-09T10:00:00+09:00")]);
  assert.deepEqual([r[0].start, r[0].end], ["00:00", "24:00"]);
});

t("長さが無くなるものは出さない", () => {
  // 前日23:00〜当日00:00 は、この日には何も占めていない
  const r = build([ev("2026-09-06T23:00:00+09:00", `${DAY}T00:00:00+09:00`)]);
  assert.equal(r.length, 0);
});

// ---------------------------------------------------------------- その他

t("カレンダー名を持ち回る", () => {
  const r = buildOverlay({
    events: [ev(`${DAY}T09:00:00+09:00`, `${DAY}T10:00:00+09:00`)],
    calendarName: "仕事",
    date: DAY,
    parse: fromRfc3339,
  });
  assert.equal(r[0].calendarName, "仕事");
});

t("空の入力でも落ちない", () => {
  assert.deepEqual(build([]), []);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
