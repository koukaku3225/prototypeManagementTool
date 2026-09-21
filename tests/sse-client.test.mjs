/**
 * 対話の SSE を読む側のテスト（2026-09-22）。
 *
 * サーバーは応答の最後に必ず `done` を送る。`done` が来ないまま流れが閉じたのに
 * 成功として戻ると、useConversation の status が "streaming" のまま残り、
 * 入力欄が無効なまま送り直せなくなる。
 * 途中で切れたら、例外にして「エラー＋再送」の経路へ流す。
 */
import assert from "node:assert/strict";
import { consumeSse, STREAM_CUT_MESSAGE } from "../src/lib/sse-client.ts";

let passed = 0;
let failed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`✗ ${name}\n  ${err.message}`);
  }
}

const enc = new TextEncoder();
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** chunks を順に流して閉じる ReadableStream */
function streamOf(chunks) {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

function recorder() {
  const r = { deltas: [], done: null, errors: [] };
  return {
    r,
    h: {
      onDelta: (x) => r.deltas.push(x),
      onDone: (p) => (r.done = p),
      onError: (m) => {
        r.errors.push(m);
        throw new Error(m);
      },
    },
  };
}

await t("done まで届けば正常に終わる", async () => {
  const { r, h } = recorder();
  await consumeSse(
    streamOf([
      frame("delta", { text: "こん" }),
      frame("delta", { text: "にちは" }),
      frame("done", { phase: "meaning", forced: false }),
    ]),
    h,
  );
  assert.deepEqual(r.deltas, ["こん", "にちは"]);
  assert.deepEqual(r.done, { phase: "meaning", forced: false });
});

await t("done が来ないまま閉じたら例外にする（画面が streaming のまま固まらない）", async () => {
  const { r, h } = recorder();
  await assert.rejects(
    () => consumeSse(streamOf([frame("delta", { text: "途中まで" })]), h),
    { message: STREAM_CUT_MESSAGE },
  );
  assert.deepEqual(r.deltas, ["途中まで"]);
  assert.equal(r.done, null);
});

await t("何も届かないまま閉じても例外にする", async () => {
  const { h } = recorder();
  await assert.rejects(() => consumeSse(streamOf([]), h), { message: STREAM_CUT_MESSAGE });
});

await t("done の枠が途中で切れていたら（末尾の空行が無い）届いていない扱い", async () => {
  const { r, h } = recorder();
  const cut = frame("done", { phase: "meaning", forced: false }).slice(0, -2);
  await assert.rejects(
    () => consumeSse(streamOf([frame("delta", { text: "a" }), cut]), h),
    { message: STREAM_CUT_MESSAGE },
  );
  assert.equal(r.done, null);
});

await t("枠がチャンクの途中で割れていても読める", async () => {
  const { r, h } = recorder();
  const all = frame("delta", { text: "あ" }) + frame("done", { phase: "smart", forced: true });
  const bytes = enc.encode(all);
  // 1バイトずつ流す（日本語の途中で割れても TextDecoder が繋ぐ）
  const stream = new ReadableStream({
    start(c) {
      for (const b of bytes) c.enqueue(new Uint8Array([b]));
      c.close();
    },
  });
  await consumeSse(stream, h);
  assert.deepEqual(r.deltas, ["あ"]);
  assert.deepEqual(r.done, { phase: "smart", forced: true });
});

await t("サーバーが error を送ってきたら、その文言のまま例外になる", async () => {
  const { r, h } = recorder();
  await assert.rejects(
    () => consumeSse(streamOf([frame("error", { message: "少し混み合っています。" })]), h),
    { message: "少し混み合っています。" },
  );
  assert.deepEqual(r.errors, ["少し混み合っています。"]);
});

await t("壊れた JSON の枠は、英語の構文エラーではなく日本語の案内にする", async () => {
  const { h } = recorder();
  await assert.rejects(
    () => consumeSse(streamOf(["event: delta\ndata: {broken\n\n"]), h),
    (err) => /もう一度送ってください/.test(err.message) && !/JSON|Unexpected/.test(err.message),
  );
});

await t("知らないイベントは読み飛ばし、done が来れば終われる", async () => {
  const { r, h } = recorder();
  await consumeSse(
    streamOf([frame("ping", { x: 1 }), frame("done", { phase: "meaning", forced: false })]),
    h,
  );
  assert.deepEqual(r.done, { phase: "meaning", forced: false });
});

console.log(`${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
