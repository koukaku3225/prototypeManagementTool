/**
 * isFinalTurn() のテスト。
 *
 * 締めの指示（COMMITMENT_INSTRUCTION/CLOSING_INSTRUCTION）は「明日のタスクが
 * 決まった」と決めつけたうえで <<<PHASE:done>>> を出させる。woop_wbs は
 * 障害→状況→If-Then→タスク選び→いつ・どこで、の5手あるフェーズで、
 * 上限は PHASE_TURN_LIMIT.woop_wbs（10）まで上げてある。締めの指示が
 * それより早いターンから混ざると、5手目に届く前からフェーズ指示と
 * 逆方向に引っ張り合う。上限に連動しているかをここで固定する。
 */
import assert from "node:assert/strict";
import { buildSystem, isFinalTurn } from "../src/lib/chat-prompt.ts";
import { REPHRASE_INSTRUCTION } from "../src/lib/prompts/phases.ts";
import { COACHING_PRINCIPLES } from "../src/lib/prompts/principles.ts";
import { ChatRequestSchema } from "../src/lib/api-schema.ts";
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

// ---- 「別の質問にする」ボタン（R10 追加、2026-09-14） ----

const texts = (body) => buildSystem(body).map((b) => b.text);

t("rephrase のときだけ、質問を変える指示が system に入る", () => {
  assert.ok(texts(req({ phase: "smart", turnsInPhase: 2, rephrase: true })).includes(REPHRASE_INSTRUCTION));
  assert.ok(!texts(req({ phase: "smart", turnsInPhase: 2 })).includes(REPHRASE_INSTRUCTION));
  assert.ok(!texts(req({ phase: "smart", turnsInPhase: 2, rephrase: false })).includes(REPHRASE_INSTRUCTION));
});

t("質問を変える指示は、キャッシュ境界の外（末尾）に置く", () => {
  const blocks = buildSystem(req({ phase: "smart", turnsInPhase: 2, rephrase: true }));
  const last = blocks[blocks.length - 1];
  assert.equal(last.text, REPHRASE_INSTRUCTION);
  assert.equal(last.cache_control, undefined, "毎回は出ない指示に境界を打つと、書き込みだけ増える");
});

t("質問を変える指示は、同じ型の問いを繰り返させない", () => {
  assert.match(REPHRASE_INSTRUCTION, /同じ型/);
  assert.match(REPHRASE_INSTRUCTION, /PHASE/, "制御トークンの付け方を外させない");
});

t("共通の原則に、同語反復や根っこの欲求に着いたら掘り続けない決まりがある", () => {
  assert.match(COACHING_PRINCIPLES, /同じ型の問い/);
  assert.match(COACHING_PRINCIPLES, /掘り続けない/);
});

const baseBody = {
  mode: "small",
  coachId: "kaede",
  phase: "smart",
  turnsInPhase: 2,
  messages: [{ role: "user", content: "こんにちは" }],
  profile: null,
  bigStory: null,
  commitmentStep: false,
};

t("API は rephrase を省略しても受け付ける（既存クライアント互換）", () => {
  assert.equal(ChatRequestSchema.safeParse(baseBody).success, true);
});

t("API は rephrase の真偽値を受け付け、それ以外は弾く", () => {
  assert.equal(ChatRequestSchema.safeParse({ ...baseBody, rephrase: true }).success, true);
  assert.equal(ChatRequestSchema.safeParse({ ...baseBody, rephrase: "yes" }).success, false);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
