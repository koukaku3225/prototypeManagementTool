/**
 * スマホアプリとして入れる案内（pwa.ts）の分岐を全通り固定する。
 *
 * 取り違えると「iPhone でボタンを押しても何も起きない」
 * 「もう入れたのに毎回インストールを勧められる」という形で表に出る。
 * 実行は `npm test`。
 */
import assert from "node:assert/strict";
import { installMode, isIOS } from "../src/lib/pwa.ts";

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

const UA = {
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1",
  // iPadOS の Safari は Mac を名乗る
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0",
};

t("アプリとして開いているなら、どの端末でも何も勧めない", () => {
  for (const ua of Object.values(UA)) {
    assert.equal(
      installMode({ standalone: true, hasPrompt: true, userAgent: ua, maxTouchPoints: 5 }),
      "installed",
    );
  }
});

t("Android の Chrome はボタン1つで入れられる", () => {
  assert.equal(
    installMode({ standalone: false, hasPrompt: true, userAgent: UA.android, maxTouchPoints: 5 }),
    "prompt",
  );
});

t("iPhone は Safari でも Chrome でも手順の案内になる", () => {
  for (const ua of [UA.iphone, UA.iphoneChrome]) {
    assert.equal(
      installMode({ standalone: false, hasPrompt: false, userAgent: ua, maxTouchPoints: 5 }),
      "ios",
    );
  }
});

t("iPad（Mac を名乗る）も手順の案内になる", () => {
  assert.equal(isIOS(UA.ipad, 5), true);
  assert.equal(
    installMode({ standalone: false, hasPrompt: false, userAgent: UA.ipad, maxTouchPoints: 5 }),
    "ios",
  );
});

t("Mac（指で触れない）は iPad と取り違えない", () => {
  assert.equal(isIOS(UA.mac, 0), false);
});

t("ダイアログを呼べないブラウザは、メニューからの案内になる", () => {
  assert.equal(
    installMode({ standalone: false, hasPrompt: false, userAgent: UA.firefox, maxTouchPoints: 0 }),
    "manual",
  );
  // Android でも、ダイアログがまだ来ていなければ案内に回す（ボタンが空振りしないように）
  assert.equal(
    installMode({ standalone: false, hasPrompt: false, userAgent: UA.android, maxTouchPoints: 5 }),
    "manual",
  );
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
