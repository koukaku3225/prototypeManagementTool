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
import { GoogleApiError, needsReconnect } from "../src/lib/calendar/google.ts";
import { CalendarOverlayQuerySchema } from "../src/lib/api-schema.ts";

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

// ------------------------------------------------ 権限不足の伝わり方

/*
 * 2026-09-08 指摘2の回帰。
 *
 * 読み取りスコープ（calendar.readonly）を後から足しても、OAuthで許可された
 * 権限は同意時点の refresh_token に固定される。既に連携済みの人には遡って
 * 付かないので、Google は403を返し続ける。これを他の失敗と一緒くたに
 * 「読めませんでした」へ丸めていたため、**重ね表示が永久に0件のまま、
 * 理由がどこにも出なかった**。再連携でしか直らない失敗は必ず区別する。
 */
t("【回帰】403は『連携し直せば直る』失敗として区別する", () => {
  assert.equal(needsReconnect(new GoogleApiError(403, "権限不足")), true);
});

t("【回帰】401も同じ（本人がGoogle側で許可を取り消した）", () => {
  assert.equal(needsReconnect(new GoogleApiError(401, "無効")), true);
});

t("通信障害や5xxは再連携では直らないので、区別しない", () => {
  assert.equal(needsReconnect(new GoogleApiError(500, "サーバー障害")), false);
  assert.equal(needsReconnect(new GoogleApiError(429, "レート制限")), false);
  assert.equal(needsReconnect(new Error("ネットワークに繋がらない")), false);
  assert.equal(needsReconnect(undefined), false);
});

t("GoogleApiError はステータスを持ったまま投げられる", () => {
  const e = new GoogleApiError(403, "権限不足");
  assert.equal(e.status, 403);
  assert.ok(e instanceof Error, "catch で拾えなければ意味が無い");
});

// ------------------------------------------------ 入力の検証

/*
 * 日付以外の文字列で Google を叩かせない。
 * AGENTS.md の「入力は必ず api-schema.ts の zod を通す」に揃えた箇所。
 */
t("日付は YYYY-MM-DD だけ通す", () => {
  assert.equal(CalendarOverlayQuerySchema.safeParse({ date: DAY }).success, true);
  for (const bad of ["", "2026-9-7", "2026-09-07T00:00", "../../etc", "primary"]) {
    assert.equal(
      CalendarOverlayQuerySchema.safeParse({ date: bad }).success,
      false,
      `通してはいけない入力を通した: ${JSON.stringify(bad)}`,
    );
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
