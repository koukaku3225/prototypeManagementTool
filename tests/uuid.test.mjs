/**
 * isValidUuid のテスト。
 *
 * ここを緩めると不正なIDがクラウドへ送られ、Postgres が 22P02 で
 * **その回の書き込みをまるごと拒否**する。1件の不正が他の全予定を
 * 道連れにし、しかも本人の操作は成功して見えるので気づけない。
 * 逆に厳しすぎると、他所が作った正当なUUIDを弾いて同期が止まる。
 * 両側の境界を固定しておく。実行は `npm test`。
 */
import assert from "node:assert/strict";
import { isValidUuid } from "../src/lib/uuid.ts";

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

// ---------------------------------------------------------------- 通すもの

t("crypto.randomUUID() が作る形を通す", () => {
  for (let i = 0; i < 20; i++) {
    const id = crypto.randomUUID();
    assert.equal(isValidUuid(id), true, `弾いてしまった: ${id}`);
  }
});

t("大文字でも通す（Postgres は大小を問わない）", () => {
  assert.equal(isValidUuid("A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11"), true);
});

t("v4 以外の版・バリアントも通す", () => {
  // 版を厳密に見ると、他所が作った正当なUUIDを弾いてしまう
  assert.equal(isValidUuid("a0eebc99-9c0b-11ef-bb6d-6bb9bd380a11"), true); // v1
  assert.equal(isValidUuid("00000000-0000-0000-0000-000000000000"), true); // nil
});

// ---------------------------------------------------------------- 弾くもの

t("移行 v2 が作る from-task-* を弾く", () => {
  // これが実際に混入して、時間割の同期をまるごと止めていた形
  assert.equal(isValidUuid("from-task-1"), false);
  assert.equal(isValidUuid("from-task-a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"), false);
});

t("習慣から起こした枠の仮IDを弾く", () => {
  assert.equal(isValidUuid("habit-abc-2026-09-06"), false);
});

t("長さ・区切りが違うものを弾く", () => {
  assert.equal(isValidUuid("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a1"), false); // 1桁短い
  assert.equal(isValidUuid("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a111"), false); // 1桁長い
  assert.equal(isValidUuid("a0eebc999c0b4ef8bb6d6bb9bd380a11"), false); // ハイフンなし
});

t("16進以外の文字を弾く", () => {
  assert.equal(isValidUuid("g0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"), false);
});

t("前後に余分な文字が付いたものを弾く", () => {
  // 部分一致で通すと、接頭辞つきIDをそのまま送ってしまう
  assert.equal(isValidUuid(" a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"), false);
  assert.equal(isValidUuid("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11 "), false);
  assert.equal(isValidUuid("x-a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"), false);
  assert.equal(isValidUuid("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11-x"), false);
});

t("文字列でないもの・空を弾く", () => {
  assert.equal(isValidUuid(""), false);
  assert.equal(isValidUuid(null), false);
  assert.equal(isValidUuid(undefined), false);
  assert.equal(isValidUuid(123), false);
  assert.equal(isValidUuid({}), false);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
