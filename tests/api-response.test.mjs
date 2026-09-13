/**
 * /api/structure の応答の読み分け。
 *
 * 2026-09-14 に Vercel の打ち切り（JSONではない素のテキスト）を res.json() で読み、
 * 「Unexpected token 'A', "An error o"... is not valid JSON」という英語が画面に出た。
 * 同じ壊れ方をもう一度しないよう、実際に返ってきた形で固定する。
 */
import assert from "node:assert/strict";
import { parseApiResponse } from "../src/lib/api-response.ts";

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

const VERCEL_TIMEOUT = "An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\n\nhnd1::abcde-1234";

t("成功したJSONはそのまま返す", () => {
  const r = parseApiResponse(200, "application/json", '{"card":{"x":1}}');
  assert.deepEqual(r, { ok: true, data: { card: { x: 1 } } });
});

t("Vercelの打ち切り（素のテキスト）は構文エラーにせず、日本語で伝える。自動ではやり直さない", () => {
  const r = parseApiResponse(504, "text/plain; charset=utf-8", VERCEL_TIMEOUT);
  assert.equal(r.ok, false);
  assert.match(r.message, /時間がかかりすぎて/);
  assert.match(r.message, /対話は保存/);
  assert.equal(r.retryable, false);
  assert.doesNotMatch(r.message, /Unexpected token|JSON/);
});

t("ステータスが504でなくても、本文が打ち切りなら打ち切りとして扱う", () => {
  const r = parseApiResponse(500, null, VERCEL_TIMEOUT);
  assert.match(r.message, /時間がかかりすぎて/);
});

t("その他のHTMLエラーページは、HTTPの番号つきで伝える", () => {
  const r = parseApiResponse(502, "text/html", "<html>Bad Gateway</html>");
  assert.equal(r.ok, false);
  assert.match(r.message, /HTTP 502/);
  assert.equal(r.retryable, false);
});

t("サーバーが返したJSONのエラー文言はそのまま出す", () => {
  const r = parseApiResponse(429, "application/json", '{"error":"rate_limited","message":"少し混み合っています。"}');
  assert.deepEqual(r, { ok: false, message: "少し混み合っています。", retryable: false });
});

t("上流の一時的な5xxだけは自動で1回やり直してよい", () => {
  assert.equal(parseApiResponse(529, "application/json", '{"message":"x"}').retryable, true);
  assert.equal(parseApiResponse(502, "application/json", '{"message":"x"}').retryable, true);
  assert.equal(parseApiResponse(504, "application/json", '{"message":"x"}').retryable, false);
});

t("JSONと名乗って壊れた本文でも落ちない", () => {
  const r = parseApiResponse(200, "application/json", "{broken");
  assert.equal(r.ok, false);
  assert.match(r.message, /読み取れませんでした/);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
