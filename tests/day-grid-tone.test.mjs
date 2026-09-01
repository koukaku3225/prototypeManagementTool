/**
 * DayGrid.tsx の TONE（色ごとの見た目）と、BOX_COLORS（timebox.ts）の
 * キーが一致しているかのテスト。
 *
 * TONE は Tailwind の静的解析制約のため BOX_COLORS から自動生成できず、
 * 手で1色ぶんずつ書いてある（DayGrid.tsx のコメント参照）。
 * BOX_COLORS に色を足してここへの追記を忘れると、その色は
 * TONE.slate へ無警告でフォールバックし、新しい色が鼠色として描かれる。
 * 目で見て気づける類のズレではないので、ここで機械的に確かめる。
 */
import assert from "node:assert/strict";
import { BOX_COLORS } from "../src/lib/timebox.ts";
import { TONE } from "../src/components/DayGrid.tsx";

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

t("BOX_COLORS の色は、すべて TONE にも見た目を持つ", () => {
  for (const c of BOX_COLORS) {
    assert.ok(TONE[c], `TONE に "${c}" が無い（DayGrid.tsx へ1行足す）`);
  }
});

t("TONE に、BOX_COLORS に無い余分な色は無い", () => {
  // 使われなくなった色を消し忘れても実害は薄いが、対応関係を保つ
  for (const key of Object.keys(TONE)) {
    assert.ok(
      BOX_COLORS.includes(key),
      `TONE の "${key}" は BOX_COLORS に無い（typebox.ts 側で消えた色）`,
    );
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
