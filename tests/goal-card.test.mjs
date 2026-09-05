/**
 * goalCardLabel のテスト。
 *
 * label 未設定の古いカードでも壊れず、vision の長文をそのまま
 * 選択肢に流さないことだけを確認する。実行は `npm test`。
 */
import assert from "node:assert/strict";
import { goalCardLabel } from "../src/lib/goal-card.ts";

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

function card(over) {
  return {
    id: "x",
    createdAt: "",
    updatedAt: "",
    coachId: "kaede",
    vision: { raw: "", refined: "" },
    meaning: { whyChain: [], values: [], motivationType: "internal", reframed: null, reframedFrom: null },
    smart: { specific: "", measurable: "", metricUnit: null, metricTarget: null, deadline: "", achievableNote: "" },
    woop: { wish: "", outcome: "", obstacles: [] },
    commitment: { accepted: false, acceptedAt: null, userWords: null },
    editedFields: [],
    ...over,
  };
}

t("label があればそれをそのまま使う", () => {
  assert.equal(
    goalCardLabel(card({ label: "副業", vision: { raw: "", refined: "長い文章がここに入る想定" } })),
    "副業",
  );
});

t("label が空文字・空白のみなら vision にフォールバックする", () => {
  assert.equal(goalCardLabel(card({ label: "  ", vision: { raw: "", refined: "短い目標" } })), "短い目標");
});

t("label が無いと vision.refined を短く切り詰める", () => {
  const label = goalCardLabel(card({ vision: { raw: "", refined: "1234567890123456789" } }));
  assert.equal(label, "12345678901234…");
});

t("label も vision も無ければプレースホルダを返す", () => {
  assert.equal(goalCardLabel(card()), "（未記入の目標）");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
