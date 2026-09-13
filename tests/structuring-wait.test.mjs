/**
 * structuring-wait.ts のテスト。
 *
 * /api/structure は実データで75秒かかる（docs/reports/2026-09-14-目標の整理が失敗した原因.md）。
 * 経過時間ごとに文言が変わり、途中で閉じないよう促す文言まで到達することを固定する。
 */
import assert from "node:assert/strict";
import { structuringMessage } from "../src/lib/structuring-wait.ts";

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.error(`FAIL: ${name}`);
    console.error(e);
  }
}

t("開始直後は最初の文言", () => {
  assert.equal(structuringMessage(0), "あなたの言葉を整理しています…");
  assert.equal(structuringMessage(11_999), "あなたの言葉を整理しています…");
});

t("12秒を超えると2段目の文言に変わる", () => {
  assert.equal(structuringMessage(12_000), "実行できる形に、じっくり落とし込んでいます…");
  assert.equal(structuringMessage(34_999), "実行できる形に、じっくり落とし込んでいます…");
});

t("35秒を超えると閉じないよう促す文言に変わる", () => {
  assert.equal(structuringMessage(35_000), "もう少しで終わります。閉じずにお待ちください…");
  assert.equal(structuringMessage(59_999), "もう少しで終わります。閉じずにお待ちください…");
});

t("60秒を超えても止まっていないことを伝え続ける（実測75秒に届く）", () => {
  const msg = structuringMessage(60_000);
  assert.equal(
    msg,
    "時間がかかっていますが、続けています。閉じると最初からやり直しになるので、もう少しだけお待ちください…",
  );
  assert.equal(structuringMessage(120_000), msg, "長引いても同じ文言のまま止まる");
});

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
