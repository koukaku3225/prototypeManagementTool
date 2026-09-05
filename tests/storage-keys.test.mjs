/**
 * hasUserContent のテスト。
 *
 * ここを間違えると「まっさらな端末」を「中身あり」と誤判定し、
 * 復元の申し出が出ない・空のスナップショットが最新を上書きする・
 * 同期の向きを取り違えてクラウドを消す、という形で表に出る。
 * 実際に起きた不具合なので、境界だけは固定しておく。実行は `npm test`。
 */
import assert from "node:assert/strict";
import { hasUserContent, DEVICE_LOCAL_KEYS, KEY } from "../src/lib/storage-keys.ts";

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

t("端末固有のキーしか無ければ「中身なし」", () => {
  // これが本来の「まっさらなブラウザ」。以前はここを true と判定していた
  assert.equal(
    hasUserContent({
      [KEY.schemaVersion]: "3",
      [KEY.variant]: '"a"',
    }),
    false,
  );
});

t("空配列・空オブジェクトは中身として数えない", () => {
  assert.equal(
    hasUserContent({
      [KEY.schemaVersion]: "3",
      [KEY.cards]: "[]",
      [KEY.timeboxes]: "[]",
      [KEY.profile]: "{}",
      [KEY.bigstory]: "null",
    }),
    false,
  );
});

t("カードが1枚でもあれば「中身あり」", () => {
  assert.equal(
    hasUserContent({ [KEY.schemaVersion]: "3", [KEY.cards]: '[{"id":"x"}]' }),
    true,
  );
});

t("大きな物語だけでも「中身あり」", () => {
  assert.equal(hasUserContent({ [KEY.bigstory]: '{"id":"x"}' }), true);
});

t("空のスナップショットは「中身なし」", () => {
  assert.equal(hasUserContent({}), false);
});

t("走行中の打刻は端末固有なので中身として数えない", () => {
  // 打刻中というだけでクラウドを正にできなくなるのは行きすぎ
  assert.equal(hasUserContent({ [KEY.running]: '{"startedAt":"x"}' }), false);
});

t("端末固有キーの一覧に running / variant / schemaVersion が入っている", () => {
  assert.ok(DEVICE_LOCAL_KEYS.includes(KEY.running));
  assert.ok(DEVICE_LOCAL_KEYS.includes(KEY.variant));
  assert.ok(DEVICE_LOCAL_KEYS.includes(KEY.schemaVersion));
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
