/**
 * 対話画面の「切り上げて次へ」「別の質問にする」ボタンの出し分けと、
 * ターンの数え方のテスト（R10、2026-09-14）。
 *
 * どちらもユーザーが対話の流れに割り込む操作なので、
 * 応答の途中に押せたり、押しただけでターン上限が近づいたりすると壊れ方が見えにくい。
 */
import assert from "node:assert/strict";
import {
  REPHRASE_USER_TEXT,
  canRephrase,
  canSkipPhase,
  isRephraseMessage,
  skipTarget,
  turnsAfterReply,
} from "../src/lib/conversation-controls.ts";

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

const msg = (role, content = "x", over = {}) => ({ role, content, phase: "smart", timestamp: "t", ...over });
const view = (over = {}) => ({
  status: "idle",
  pendingPhase: null,
  completedAt: null,
  messages: [msg("assistant", "どれくらいやりますか？")],
  ...over,
});

// ---- 別の質問にする ----

t("コーチが問いを出して待っているときだけ、別の質問にできる", () => {
  assert.equal(canRephrase(view()), true);
});

t("応答の途中・完了後・エラー中は押せない", () => {
  for (const status of ["streaming", "done", "error"]) {
    assert.equal(canRephrase(view({ status })), false, status);
  }
  assert.equal(canRephrase(view({ completedAt: "2026-09-14T00:00:00.000Z" })), false);
});

t("最後の発言がユーザーなら押せない（コーチがまだ何も聞いていない）", () => {
  assert.equal(canRephrase(view({ messages: [msg("assistant"), msg("user")] })), false);
  assert.equal(canRephrase(view({ messages: [] })), false);
});

t("やり直しで無効になった発言は数えない", () => {
  const messages = [msg("assistant"), msg("user", "y", { invalidated: true })];
  assert.equal(canRephrase(view({ messages })), true);
});

t("質問を変えてほしい、という発言を見分けられる", () => {
  assert.equal(isRephraseMessage(REPHRASE_USER_TEXT), true);
  assert.equal(isRephraseMessage("別にいいです"), false);
});

// ---- ターンの数え方 ----

t("ふつうの返答は1ターン進む", () => {
  assert.equal(turnsAfterReply(3, false), 4);
});

t("別の質問にしてもらった応答は、ターンに数えない（押すほど上限が近づかない）", () => {
  assert.equal(turnsAfterReply(3, true), 3);
});

// ---- 切り上げて次へ ----

t("待っている間は切り上げられる。応答の途中・完了後は切り上げられない", () => {
  assert.equal(canSkipPhase(view()), true);
  assert.equal(canSkipPhase(view({ status: "error" })), true, "応答が取れないときこそ抜けられる必要がある");
  assert.equal(canSkipPhase(view({ status: "streaming" })), false);
  assert.equal(canSkipPhase(view({ status: "done" })), false);
  assert.equal(canSkipPhase(view({ completedAt: "2026-09-14T00:00:00.000Z" })), false);
});

t("「次へ」の案内が出ているときは、切り上げボタンを出さない（正規の進み方がある）", () => {
  assert.equal(canSkipPhase(view({ pendingPhase: "woop_wbs" })), false);
});

t("切り上げ先は次のステップ。最後のステップなら完了", () => {
  assert.equal(skipTarget("small", "diverge"), "smart");
  assert.equal(skipTarget("small", "smart"), "woop_wbs");
  assert.equal(skipTarget("small", "woop_wbs"), "done");
  assert.equal(skipTarget("big", "big_position"), "done");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
