/**
 * 同期の帯を出すかどうかを総当たりで固定する。
 *
 * この帯は「黙って壊れるのを防ぐ」ために置いたのに、次の2つを抱えていた。
 *   1. 失敗を取り下げる経路が無く、一度出たら成功しても出続ける
 *   2. 一度「閉じる」と二度と戻らず、本物の失敗が完全に無言になる
 * どちらも実際に本番へ出てしまった。ここで両方向を固定する。
 *
 * 実行は `npm test`。
 */
import assert from "node:assert/strict";
import { shouldShowSyncBar, syncBarKey } from "../src/lib/supabase/sync-bar.ts";

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

const ALL_KINDS = [
  "off",
  "checking",
  "pulling",
  "pushing",
  "ready",
  "conflict",
  "failed",
];

// ------------------------------------------------ 出す／出さないの基本

t("放っておけば終わる状態では出さない（失敗も無い）", () => {
  for (const kind of ["off", "checking", "pulling", "pushing", "ready"]) {
    assert.equal(
      shouldShowSyncBar({ stateKind: kind, errorAt: null, dismissedKey: null }),
      false,
      `${kind} で出てしまった`,
    );
  }
});

t("本人が動かないと直らない状態では出す", () => {
  for (const kind of ["conflict", "failed"]) {
    assert.equal(
      shouldShowSyncBar({ stateKind: kind, errorAt: null, dismissedKey: null }),
      true,
      `${kind} で出ない`,
    );
  }
});

t("状態が ready でも、個々の保存が失敗していれば出す", () => {
  // timeboxes だけ弾かれ続けた実例。状態だけ見ていると取りこぼす
  assert.equal(
    shouldShowSyncBar({
      stateKind: "ready",
      errorAt: "2026-09-07T00:00:00.000Z",
      dismissedKey: null,
    }),
    true,
  );
});

// ------------------------------------------------ 成功したら消えること

t("【回帰】失敗が取り下げられたら、帯は消える", () => {
  // errorAt が null に戻る＝sync.ts が clearFailure() した状態。
  // 以前はここで出続け、保存できているのに「止まっています」と言い続けた
  assert.equal(
    shouldShowSyncBar({ stateKind: "ready", errorAt: null, dismissedKey: null }),
    false,
  );
});

// ------------------------------------------------ 閉じたあとの復活

t("【回帰】閉じた後でも、別の失敗が起きたら必ず出し直す", () => {
  const first = "2026-09-07T00:00:00.000Z";
  const second = "2026-09-07T00:05:00.000Z";
  // 1件目を閉じた状態
  assert.equal(
    shouldShowSyncBar({
      stateKind: "ready",
      errorAt: first,
      dismissedKey: syncBarKey("ready", first),
    }),
    false,
    "閉じた直後なのに出ている",
  );
  // 別の失敗が起きた
  assert.equal(
    shouldShowSyncBar({
      stateKind: "ready",
      errorAt: second,
      dismissedKey: syncBarKey("ready", first),
    }),
    true,
    "閉じた記憶が居座り、本物の失敗が無言になっている",
  );
});

t("同じ失敗を閉じたら、そのままでは出さない", () => {
  const at = "2026-09-07T00:00:00.000Z";
  assert.equal(
    shouldShowSyncBar({
      stateKind: "failed",
      errorAt: at,
      dismissedKey: syncBarKey("failed", at),
    }),
    false,
  );
});

t("conflict を閉じても、失敗が起きれば出す", () => {
  assert.equal(
    shouldShowSyncBar({
      stateKind: "ready",
      errorAt: "2026-09-07T00:00:00.000Z",
      dismissedKey: "conflict",
    }),
    true,
  );
});

// ------------------------------------------------ 鍵の性質

t("鍵: conflict は時刻を持たないので状態そのものを使う", () => {
  assert.equal(syncBarKey("conflict", null), "conflict");
  // conflict 中に失敗時刻があっても、conflict を優先する
  assert.equal(syncBarKey("conflict", "2026-09-07T00:00:00.000Z"), "conflict");
});

t("鍵: 失敗があれば時刻、無ければ状態", () => {
  assert.equal(syncBarKey("ready", "2026-09-07T00:00:00.000Z"), "2026-09-07T00:00:00.000Z");
  assert.equal(syncBarKey("failed", null), "failed");
});

t("鍵は状況が変われば必ず変わる（居座らない）", () => {
  const keys = new Set();
  for (const kind of ALL_KINDS) keys.add(syncBarKey(kind, null));
  // conflict 以外は状態名がそのまま鍵になるので、重複しない
  assert.equal(keys.size, ALL_KINDS.length);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
