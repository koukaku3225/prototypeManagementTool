/**
 * 書き出し（Markdown）のテスト。
 *
 * `card.createdAt` は `toISOString()` で保存した UTC の日時。
 * ここを `.slice(0, 10)` で切ると、JST 朝9時までに作った目標の
 * 「作成日」が前日になる（AGENTS.md が名指しで禁止しているパターン）。
 */
process.env.TZ = "Asia/Tokyo";

import assert from "node:assert/strict";
import { toMarkdown } from "../src/lib/export.ts";

function card(createdAt) {
  return {
    id: "x",
    createdAt,
    updatedAt: "",
    coachId: "kaede",
    vision: { raw: "テスト目標", refined: "" },
    meaning: { whyChain: [], values: [], motivationType: "internal", reframed: null, reframedFrom: null },
    smart: { specific: "", measurable: "", metricUnit: null, metricTarget: null, deadline: "", achievableNote: "" },
    woop: { wish: "", outcome: "", obstacles: [] },
    commitment: { accepted: false, acceptedAt: null, userWords: null },
    editedFields: [],
  };
}

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

t("作成日はJSTの暦日で出る（UTC深夜=JST翌朝でも日付が進む）", () => {
  // UTC 2026-08-25T16:30 = JST 2026-08-26 01:30
  const md = toMarkdown(card("2026-08-25T16:30:00.000Z"));
  assert.match(md, /作成日: 2026-08-26/);
  assert.doesNotMatch(md, /作成日: 2026-08-25/);
});

t("作成日はJST日中ならそのままの日付", () => {
  // UTC 2026-08-25T03:00 = JST 2026-08-25 12:00
  const md = toMarkdown(card("2026-08-25T03:00:00.000Z"));
  assert.match(md, /作成日: 2026-08-25/);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
