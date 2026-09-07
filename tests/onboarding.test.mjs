/**
 * 初回の案内を出す条件を固定する。
 *
 * 出さなすぎると、何も持っていない人が空のグリッドに置き去りになる
 * （既定表示を時間割にしたときに実際にそうなった）。
 * 出しすぎると、もう使っている人の邪魔をする。両側を固定する。
 * 実行は `npm test`。
 */
import assert from "node:assert/strict";
import { shouldShowOnboarding } from "../src/lib/onboarding.ts";

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

const EMPTY = {
  hasBigStory: false,
  cardCount: 0,
  timeBoxCount: 0,
  habitCount: 0,
  dismissed: false,
};

t("何も持っていない人には出す", () => {
  assert.equal(shouldShowOnboarding(EMPTY), true);
});

t("「先に時間割だけ使う」を選んだら出さない", () => {
  assert.equal(shouldShowOnboarding({ ...EMPTY, dismissed: true }), false);
});

t("1つでも持っていれば出さない（4項目すべて独立に効く）", () => {
  const cases = [
    { ...EMPTY, hasBigStory: true },
    { ...EMPTY, cardCount: 1 },
    { ...EMPTY, timeBoxCount: 1 },
    { ...EMPTY, habitCount: 1 },
  ];
  for (const c of cases) {
    assert.equal(
      shouldShowOnboarding(c),
      false,
      `既に使っている人に出している: ${JSON.stringify(c)}`,
    );
  }
});

t("既存利用者には、閉じていなくても出さない", () => {
  // 既に育っている人に初回案内が出るのは、不具合として一番目立つ
  assert.equal(
    shouldShowOnboarding({
      hasBigStory: true,
      cardCount: 3,
      timeBoxCount: 20,
      habitCount: 2,
      dismissed: false,
    }),
    false,
  );
});

t("組み合わせを総当たりしても、出るのは1通りだけ", () => {
  let shown = 0;
  for (const hasBigStory of [false, true])
    for (const cardCount of [0, 1])
      for (const timeBoxCount of [0, 1])
        for (const habitCount of [0, 1])
          for (const dismissed of [false, true])
            if (
              shouldShowOnboarding({
                hasBigStory,
                cardCount,
                timeBoxCount,
                habitCount,
                dismissed,
              })
            )
              shown++;
  assert.equal(shown, 1, "出る条件が広すぎる／狭すぎる");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
