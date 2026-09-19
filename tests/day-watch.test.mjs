/**
 * 「開いたまま日付が変わった」の番人（lib/day-watch.ts）のテスト。
 *
 * 症状：スマホで今日の画面を開いたまま寝て、朝にアプリへ戻ると、
 * 前日の予定が「今日」として出たままになっていた（読み込みが開いた瞬間の1回だけで、
 * 日付が変わったことを画面が知らなかった）。実行は `npm test`。
 */
import assert from "node:assert/strict";
import { createDayWatcher } from "../src/lib/day-watch.ts";

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}
  ${e.message}`);
  }
}

/** 時計を手で進められる番人。呼ばれた内容は calls に溜まる */
function setup(startAt) {
  let clock = new Date(startAt);
  const calls = [];
  const watcher = createDayWatcher(
    (nowDay, prevDay) => calls.push([nowDay, prevDay]),
    () => clock,
  );
  return {
    calls,
    watcher,
    at: (iso) => {
      clock = new Date(iso);
    },
  };
}

t("同じ日のあいだは、何度確認しても知らせない（読み直しを連発しない）", () => {
  const s = setup("2026-09-20T21:00:00");
  for (const at of ["2026-09-20T21:00:30", "2026-09-20T22:30:00", "2026-09-20T23:59:59"]) {
    s.at(at);
    assert.equal(s.watcher.check(), false);
  }
  assert.deepEqual(s.calls, []);
});

t("日付をまたいだら、新しい今日と読み込んでいた日を1回だけ知らせる", () => {
  const s = setup("2026-09-20T23:50:00");
  s.at("2026-09-21T07:30:00"); // 朝にアプリへ戻る
  assert.equal(s.watcher.check(), true);
  assert.deepEqual(s.calls, [["2026-09-21", "2026-09-20"]]);
});

t("知らせたあとは、その日のあいだ二度と知らせない", () => {
  const s = setup("2026-09-20T23:50:00");
  s.at("2026-09-21T00:00:10");
  s.watcher.check();
  for (const at of ["2026-09-21T00:00:40", "2026-09-21T07:00:00", "2026-09-21T23:59:00"]) {
    s.at(at);
    assert.equal(s.watcher.check(), false, at);
  }
  assert.equal(s.calls.length, 1);
});

t("何日も開きっぱなしでも、いまの日付に追いつく（前日を挟まず今日まで一気に）", () => {
  const s = setup("2026-09-20T22:00:00");
  s.at("2026-09-23T08:00:00");
  s.watcher.check();
  assert.deepEqual(s.calls, [["2026-09-23", "2026-09-20"]]);
  s.at("2026-09-24T08:00:00");
  s.watcher.check();
  assert.deepEqual(s.calls[1], ["2026-09-24", "2026-09-23"]);
});

t("月・年をまたいでも知らせる", () => {
  const a = setup("2026-09-30T23:00:00");
  a.at("2026-10-01T06:00:00");
  a.watcher.check();
  assert.deepEqual(a.calls, [["2026-10-01", "2026-09-30"]]);

  const b = setup("2026-12-31T23:00:00");
  b.at("2027-01-01T06:00:00");
  b.watcher.check();
  assert.deepEqual(b.calls, [["2027-01-01", "2026-12-31"]]);
});

t("朝9時前でも日付はローカルで数える（UTC だと前日になる時間帯）", () => {
  // JST の 2026-09-21 08:00 は UTC では 09-20。ローカルで見て 09-21 と知らせること
  const s = setup(new Date(2026, 8, 20, 22, 0, 0));
  s.at(new Date(2026, 8, 21, 8, 0, 0).toISOString());
  s.watcher.check();
  assert.deepEqual(s.calls, [["2026-09-21", "2026-09-20"]]);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
