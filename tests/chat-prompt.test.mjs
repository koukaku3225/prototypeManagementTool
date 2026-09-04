/**
 * isFinalTurn() のテスト。
 *
 * 締めの指示（COMMITMENT_INSTRUCTION/CLOSING_INSTRUCTION）は「明日のタスクが
 * 決まった」と決めつけたうえで <<<PHASE:done>>> を出させる。woop_wbs は
 * 障害→状況→If-Then→タスク選び→いつ・どこで、の5手あるフェーズで、
 * 上限は PHASE_TURN_LIMIT.woop_wbs（7）まで上げてある。締めの指示が
 * それより早いターンから混ざると、5手目に届く前からフェーズ指示と
 * 逆方向に引っ張り合う。上限に連動しているかをここで固定する。
 */
import assert from "node:assert/strict";
import { isFinalTurn } from "../src/lib/chat-prompt.ts";
import { PHASE_TURN_LIMIT } from "../src/types/goal.ts";

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

const req = (over = {}) => ({
  mode: "small",
  coachId: "kaede",
  phase: "woop_wbs",
  turnsInPhase: 0,
  messages: [],
  profile: null,
  bigStory: null,
  commitmentStep: false,
  ...over,
});

t("woop_wbs の上限より前は締めない（5手目に届く前に決めつけない）", () => {
  assert.equal(isFinalTurn(req({ turnsInPhase: 3 })), false);
  assert.equal(isFinalTurn(req({ turnsInPhase: PHASE_TURN_LIMIT.woop_wbs - 2 })), false);
});

t("上限の直前から締めの指示を出す（着地の猶予）", () => {
  assert.equal(isFinalTurn(req({ turnsInPhase: PHASE_TURN_LIMIT.woop_wbs - 1 })), true);
  assert.equal(isFinalTurn(req({ turnsInPhase: PHASE_TURN_LIMIT.woop_wbs })), true);
});

t("woop_wbs 以外のフェーズでは締めない", () => {
  assert.equal(isFinalTurn(req({ phase: "smart", turnsInPhase: 99 })), false);
  assert.equal(isFinalTurn(req({ phase: "diverge", turnsInPhase: 99 })), false);
});

t("big モードでは締めない（small専用の仕組み）", () => {
  assert.equal(isFinalTurn(req({ mode: "big", turnsInPhase: 99 })), false);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
