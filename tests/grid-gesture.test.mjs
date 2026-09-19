/**
 * 時間割で「押して離した」の解釈（grid-gesture.ts）のテスト。
 *
 * スマホの実機でしか出ない壊れ方をここで固定する。
 *   - 250ms のタップが長押しに化けて、予定が開かなくなる
 *   - 指のぶれ（数px）を「動かした」と数えて、同じ場所への保存が走る
 *
 * 実行は `npm test`。
 */
import assert from "node:assert/strict";
import {
  isRealMove,
  MOVE_SLOP_PX,
  pressOutcome,
  TAP_MAX_MS,
} from "../src/lib/grid-gesture.ts";

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

t("動かしたなら、押していた時間に関係なく確定する", () => {
  for (const heldMs of [230, 800, 5000]) {
    for (const kind of ["move", "create", "resize-start", "resize-end"]) {
      assert.equal(pressOutcome({ kind, moved: true, heldMs }), "commit", `${kind} ${heldMs}`);
    }
  }
});

t("動かしていない短い押しはタップ。予定が開く", () => {
  // 長押しの成立（220ms）を少し超えただけの、ふつうのタップ
  assert.equal(pressOutcome({ kind: "move", moved: false, heldMs: 250 }), "tap");
  assert.equal(pressOutcome({ kind: "move", moved: false, heldMs: TAP_MAX_MS - 1 }), "tap");
});

t("動かしていない長い押しは「つかんだだけ」。選択を残し、予定は開かない", () => {
  assert.equal(pressOutcome({ kind: "move", moved: false, heldMs: TAP_MAX_MS }), "hold");
  assert.equal(pressOutcome({ kind: "move", moved: false, heldMs: 1200 }), "hold");
});

t("空きを引く操作は、動かしていなければ長さに関係なくタップ（既定の長さの枠ができる）", () => {
  assert.equal(pressOutcome({ kind: "create", moved: false, heldMs: 250 }), "tap");
  assert.equal(pressOutcome({ kind: "create", moved: false, heldMs: 3000 }), "tap");
});

t("つまみを触っただけ（動かさず長く押した）なら、選択を残す", () => {
  assert.equal(pressOutcome({ kind: "resize-end", moved: false, heldMs: 900 }), "hold");
});

t("指のぶれは「動かした」と数えない", () => {
  assert.equal(isRealMove(0), false);
  assert.equal(isRealMove(MOVE_SLOP_PX), false);
  assert.equal(isRealMove(-MOVE_SLOP_PX), false);
  assert.equal(isRealMove(MOVE_SLOP_PX + 1), true);
  assert.equal(isRealMove(-(MOVE_SLOP_PX + 1)), true);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
