/**
 * 習慣の「作る形」（D1 習慣の型・D2 2分チェック・D4 摩擦の診断）の純粋関数のテスト。
 *
 * 守るもの:
 *   1. 長そうな最小版（時間を表す語・長い文）だけを「大きい」と判定する
 *      （短い最小版に案内を出すと、押し付けになる）
 *   2. 手順が3以上のときだけ、減らす案を出す
 *   3. 祝いは任意。無い・空白だけなら null
 */
import assert from "node:assert/strict";
import {
  minimalSizeCheck,
  shrinkOptions,
  frictionAdvice,
  normalizeCelebration,
  normalizeFrictionSteps,
  CELEBRATION_PRESETS,
  FRICTION_CHOICES,
} from "../src/lib/habit-shape.ts";

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

// ---------------------------------------------------------------- D2 最小版の大きさ

t("空・空白は判定しない（促さない）", () => {
  assert.equal(minimalSizeCheck("").tooBig, false);
  assert.equal(minimalSizeCheck("   ").tooBig, false);
});

t("2分以内・短い行動は大きくない", () => {
  for (const s of ["1行だけ書く", "机に座って、1行だけ書く", "素振り10回", "2分だけ書く", "30秒ストレッチ", "1分だけ"]) {
    assert.equal(minimalSizeCheck(s).tooBig, false, s);
  }
});

t("3分以上は大きい（半角・全角・漢数字）", () => {
  for (const s of ["20分だけ書く", "３０分書く", "noteを30分書く", "十分間歩く", "二十分走る", "5min走る"]) {
    assert.equal(minimalSizeCheck(s).tooBig, true, s);
  }
});

t("時間・半日などの語は大きい", () => {
  for (const s of ["1時間勉強する", "半時間だけ", "2h読む", "半日かけて片付ける"]) {
    assert.equal(minimalSizeCheck(s).tooBig, true, s);
  }
});

t("長い文（25文字超）は、時間語が無くても大きい", () => {
  const long = "帰宅したら机に座ってノートを開いて今日あったことを丁寧に振り返って書き出す";
  const r = minimalSizeCheck(long);
  assert.equal(r.tooBig, true);
  assert.equal(r.reason, "length");
});

t("理由は time / length / null で返る", () => {
  assert.equal(minimalSizeCheck("20分だけ書く").reason, "time");
  assert.equal(minimalSizeCheck("1行だけ書く").reason, null);
});

t("「十分に」のような副詞は時間と取らない", () => {
  assert.equal(minimalSizeCheck("十分に水を飲む").tooBig, false);
});

t("小さくする案は、時間の語を除いた形を含み、空にならない", () => {
  const o = shrinkOptions("noteを30分書く");
  assert.ok(o.length >= 2 && o.length <= 4);
  assert.ok(o.every((x) => x.trim().length > 0));
  assert.ok(o.some((x) => x.includes("note")));
  assert.ok(o.every((x) => !/30分/.test(x)), "元の時間語を残さない");
});

t("小さくする案は、元の文字列と同じものを返さない", () => {
  const src = "20分だけ書く";
  assert.ok(!shrinkOptions(src).includes(src));
});

// ---------------------------------------------------------------- D4 摩擦

t("手順0〜2は案を出さない", () => {
  for (const n of [0, 1, 2]) assert.equal(frictionAdvice(n).heavy, false, String(n));
});

t("手順3・4+ は減らす案を出す", () => {
  for (const n of [3, 4]) {
    const r = frictionAdvice(n);
    assert.equal(r.heavy, true);
    assert.ok(r.message.length > 0);
  }
});

t("未回答（null）は何も出さない", () => {
  const r = frictionAdvice(null);
  assert.equal(r.heavy, false);
  assert.equal(r.message, "");
});

t("摩擦の選択肢は 0,1,2,3,4 の5つで、4が「4+」", () => {
  assert.deepEqual(FRICTION_CHOICES.map((c) => c.value), [0, 1, 2, 3, 4]);
  assert.equal(FRICTION_CHOICES[4].label, "4+");
});

t("手順数は 0〜4 の整数だけ通す。壊れた値は null", () => {
  assert.equal(normalizeFrictionSteps(2), 2);
  assert.equal(normalizeFrictionSteps(0), 0);
  assert.equal(normalizeFrictionSteps(9), 4);
  assert.equal(normalizeFrictionSteps(-1), null);
  assert.equal(normalizeFrictionSteps(1.5), null);
  assert.equal(normalizeFrictionSteps("3"), null);
  assert.equal(normalizeFrictionSteps(undefined), null);
  assert.equal(normalizeFrictionSteps(null), null);
});

// ---------------------------------------------------------------- D1 祝い

t("祝いの選択肢が3つ以上ある", () => {
  assert.ok(CELEBRATION_PRESETS.length >= 3);
});

t("祝いは前後の空白を落とす。空・非文字列は null", () => {
  assert.equal(normalizeCelebration("  よし  "), "よし");
  assert.equal(normalizeCelebration(""), null);
  assert.equal(normalizeCelebration("   "), null);
  assert.equal(normalizeCelebration(null), null);
  assert.equal(normalizeCelebration(undefined), null);
  assert.equal(normalizeCelebration(5), null);
});

t("祝いは長すぎるものを切る（60文字）", () => {
  assert.equal(normalizeCelebration("あ".repeat(100)).length, 60);
});

console.log(`habit-shape: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
