/**
 * コーチの見た目のテスト。
 *
 * 見た目の表を引けないコーチIDが1つ混じるだけで、目標の一覧・目標の詳細・
 * 履歴・大きな物語が丸ごとエラー画面になる（SVG が look.bg を読むため）。
 * ID はクラウドの行と、設定画面で貼り付けた JSON からそのまま入ってくるので、
 * 表に無い値は実際に来うる。ここで「落ちない」ことを固定しておく。
 */
import assert from "node:assert/strict";
import { COACH_IDS, coachLook, DEFAULT_COACH_ID } from "../src/lib/coach-look.ts";
import { COACH_LIST } from "../src/lib/prompts/coaches.ts";

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}
  ${e.message}
`);
  }
}

t("どのコーチにも見た目がある", () => {
  for (const c of COACH_LIST) {
    assert.ok(coachLook(c.id).bg, `${c.id} の見た目が無い`);
  }
});

t("表に無いコーチIDでも、既定の見た目を返す（画面を落とさない）", () => {
  for (const bad of ["", "unknown", "KAEDE", null, undefined]) {
    const look = coachLook(bad);
    assert.equal(look, coachLook(DEFAULT_COACH_ID), `${String(bad)} で既定に落ちていない`);
    assert.ok(look.bg);
  }
});

t("COACH_IDS は対話で選べるコーチとそろっている", () => {
  assert.deepEqual([...COACH_IDS].sort(), COACH_LIST.map((c) => c.id).sort());
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
