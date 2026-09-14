/**
 * 2026-09-14 のセキュリティレビューで直した入口の検査を固定する。
 * （docs/reports/2026-09-14-security-review.md）
 *
 * どれも「通すべきでないものが通っていた」種類の不具合で、
 * 画面を触っても気づけない。ここで機械的に見張る。
 * 実行は `npm test`。
 */
import assert from "node:assert/strict";
import {
  isCrossSiteRequest,
  isJsonContentType,
  isLoopbackHost,
  readBodyLimited,
} from "../src/lib/request-guard.ts";
import { encodeStateCookie, stateMatches } from "../src/lib/calendar/oauth-state.ts";
import { MAX_WRITE_OPS, runSync } from "../src/lib/calendar/engine.ts";
import { addDays } from "../src/lib/date.ts";

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}

// ---- 指摘3: Content-Type ----

await t("【指摘3】パラメータに application/json を混ぜた text/plain を JSON と見なさない", () => {
  assert.equal(isJsonContentType("text/plain; note=application/json"), false);
  assert.equal(isJsonContentType("text/plain;application/json"), false);
  assert.equal(isJsonContentType("application/jsonp"), false);
  assert.equal(isJsonContentType(null), false);
});

await t("本物の JSON は大文字小文字・charset 付きでも通す", () => {
  assert.equal(isJsonContentType("application/json"), true);
  assert.equal(isJsonContentType("Application/JSON; charset=utf-8"), true);
});

// ---- 別サイトからの送信 ----

const req = (headers, url = "https://app.example/api/x") =>
  new Request(url, { method: "POST", headers });

await t("Sec-Fetch-Site が cross-site / same-site なら別サイト扱い", () => {
  assert.equal(isCrossSiteRequest(req({ "sec-fetch-site": "cross-site" })), true);
  assert.equal(isCrossSiteRequest(req({ "sec-fetch-site": "same-site" })), true);
  assert.equal(isCrossSiteRequest(req({ "sec-fetch-site": "same-origin" })), false);
});

await t("Sec-Fetch-Site が無ければ Origin で見る。どちらも無ければ（ブラウザ以外）通す", () => {
  assert.equal(isCrossSiteRequest(req({ origin: "https://evil.example" })), true);
  assert.equal(isCrossSiteRequest(req({ origin: "https://app.example" })), false);
  assert.equal(isCrossSiteRequest(req({})), false);
});

// ---- 補足: 本文サイズはバイトで、読みながら数える ----

await t("【補足】文字数ではなくバイト数で上限を見る（日本語は1文字3バイト）", async () => {
  const body = "あ".repeat(100); // 300バイト
  const r = await readBodyLimited(new Request("https://a.example", { method: "POST", body }), 200);
  assert.deepEqual(r, { ok: false, status: 413 });
  const ok = await readBodyLimited(new Request("https://a.example", { method: "POST", body }), 300);
  assert.deepEqual(ok, { ok: true, text: body });
});

await t("【補足】Content-Length が上限を超えていれば読む前に弾く", async () => {
  const r = await readBodyLimited(
    new Request("https://a.example", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "999999" },
    }),
    100,
  );
  assert.deepEqual(r, { ok: false, status: 413 });
});

// ---- 指摘1: バックアップAPIは loopback だけ ----

await t("【指摘1】loopback の判定", () => {
  for (const h of ["localhost:3111", "127.0.0.1", "127.0.0.1:3000", "[::1]:3111", "LOCALHOST"]) {
    assert.equal(isLoopbackHost(h), true, h);
  }
  for (const h of ["192.168.10.106:3111", "evil.example", "localhost.evil.example", "", null]) {
    assert.equal(isLoopbackHost(h), false, String(h));
  }
});

// ---- 指摘13: OAuth state を利用者に結び付ける ----

await t("【指摘13】連携を始めた利用者と戻ってきた利用者が違えば一致しない", () => {
  const cookie = encodeStateCookie("s-123", "user-A");
  assert.equal(stateMatches(cookie, "s-123", "user-A"), true);
  assert.equal(stateMatches(cookie, "s-123", "user-B"), false, "B に A の連携を保存しうる");
  assert.equal(stateMatches(cookie, "s-123", null), false);
  assert.equal(stateMatches(cookie, "s-999", "user-A"), false);
});

await t("【指摘13】古い形式（利用者なし）の Cookie や空の値は通さない", () => {
  assert.equal(stateMatches("s-123", "s-123", "user-A"), false);
  assert.equal(stateMatches(undefined, "s-123", "user-A"), false);
  assert.equal(stateMatches(encodeStateCookie("s-123", "user-A"), null, "user-A"), false);
});

// ---- 指摘12: カレンダー同期の書き込み件数 ----

await t("【指摘12】500件の枠を送っても、Google への書き込みは上限までで次回に回す", async () => {
  const day = addDays(3);
  const boxes = Array.from({ length: 500 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    date: day,
    start: "10:00",
    end: "10:30",
    title: `枠${i}`,
    googleEventId: null,
    hasNotes: false,
  }));
  let inserts = 0;
  const deps = {
    loadLink: async () => ({ userId: "u", refreshToken: "rt", calendarId: "c", syncToken: null }),
    updateLink: async () => {},
    refreshAccessToken: async () => "at",
    listEvents: async () => ({ ok: true, events: [], nextSyncToken: null }),
    insertEvent: async () => `ev${++inserts}`,
    patchEvent: async () => {},
    deleteEvent: async () => {},
  };
  const r = await runSync(boxes, false, deps);
  assert.equal(r.ok, true);
  assert.equal(inserts, MAX_WRITE_OPS);
  assert.equal(r.result.upserts.length, MAX_WRITE_OPS);
  assert.equal(r.result.truncated, true);
});

// ---- 指摘4: 代替上限（メモリ） ----

const { memoryLimit, __resetMemoryLimitForTest } = await import("../src/lib/rate-limit.ts");

await t("【指摘4】代替上限は窓の中で上限を超えたら弾き、窓が変われば戻る", () => {
  __resetMemoryLimitForTest();
  const now = 1_000_000;
  for (let i = 0; i < 5; i++) assert.equal(memoryLimit("k", 5, 60_000, 1, now), true);
  assert.equal(memoryLimit("k", 5, 60_000, 1, now), false);
  assert.equal(memoryLimit("k", 5, 60_000, 1, now + 60_000), true);
});

await t("【指摘11】件数（cost）ぶん消費する。20件のバッチは1回で上限を超える", () => {
  __resetMemoryLimitForTest();
  assert.equal(memoryLimit("b", 5, 60_000, 20, 0), false);
  assert.equal(memoryLimit("c", 5, 60_000, 5, 0), true);
  assert.equal(memoryLimit("c", 5, 60_000, 1, 0), false);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
