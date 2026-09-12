/**
 * クラウドへの押し出しをまとめる待ち行列のテスト。
 *
 * ここを間違えると、症状は「書いたのに別端末に出てこない」という形で
 * だいぶ後になってから、しかも再現しない形で出る。
 * タイマーは注入して、実時間を待たずに総当たりする。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPushQueue, PUSH_DEBOUNCE_MS } from "../src/lib/supabase/push-queue.ts";

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

/** 手で進められるタイマー。実時間は使わない */
function fakeClock() {
  let next = 1;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    /** 待ちを全部発火させる。登録順に呼ぶ */
    run() {
      const entries = [...timers.entries()];
      timers.clear();
      for (const [, e] of entries) e.fn();
    },
    live: () => timers.size,
    waits: () => [...timers.values()].map((e) => e.ms),
  };
}

function setup(over = {}) {
  const clock = fakeClock();
  const sent = [];
  const q = createPushQueue({
    debounced: ["gc.timeboxes", "gc.habits"],
    send: (key, value) => sent.push([key, value]),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...over,
  });
  return { q, sent, clock };
}

// ------------------------------------------------------------ まとめて送る

t("対象キーは、待ち時間が来るまで送らない", () => {
  const { q, sent, clock } = setup();
  q.push("gc.timeboxes", [1]);
  assert.deepEqual(sent, [], "打った瞬間には送らない");
  assert.deepEqual(q.pendingKeys(), ["gc.timeboxes"]);
  clock.run();
  assert.deepEqual(sent, [["gc.timeboxes", [1]]]);
  assert.deepEqual(q.pendingKeys(), [], "送ったら待ちから消える");
});

t("連打しても送るのは1回。いちばん新しい値だけが届く", () => {
  const { q, sent, clock } = setup();
  for (const v of ["あ", "あい", "あいう"]) q.push("gc.timeboxes", v);
  assert.equal(clock.live(), 1, "タイマーは常に1本に張り替える");
  clock.run();
  assert.deepEqual(sent, [["gc.timeboxes", "あいう"]]);
});

t("キーが違えば、別々にまとめる", () => {
  const { q, sent, clock } = setup();
  q.push("gc.timeboxes", "t");
  q.push("gc.habits", "h");
  assert.deepEqual(q.pendingKeys(), ["gc.timeboxes", "gc.habits"]);
  clock.run();
  assert.deepEqual(sent, [
    ["gc.timeboxes", "t"],
    ["gc.habits", "h"],
  ]);
});

t("既定の待ち時間は 1500ms（LocalBackupBoot の4秒より短い）", () => {
  const clock = fakeClock();
  const q = createPushQueue({
    debounced: ["gc.timeboxes"],
    send: () => {},
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  q.push("gc.timeboxes", 1);
  assert.deepEqual(clock.waits(), [PUSH_DEBOUNCE_MS]);
  assert.equal(PUSH_DEBOUNCE_MS, 1500);
});

// ------------------------------------------------------------ 素通しするもの

t("対象外のキーは、これまでどおり即座に送る", () => {
  const { q, sent, clock } = setup();
  q.push("gc.cards", [{ id: "c1" }]);
  assert.deepEqual(sent, [["gc.cards", [{ id: "c1" }]]]);
  assert.equal(clock.live(), 0, "タイマーを張らない");
});

t("消去（null）は対象キーでも即座に送る", () => {
  const { q, sent, clock } = setup();
  q.push("gc.timeboxes", null);
  assert.deepEqual(sent, [["gc.timeboxes", null]]);
  assert.equal(clock.live(), 0);
});

t("待ちがある最中の消去は、待ちを捨ててから送る（古い値が後から蘇らない）", () => {
  const { q, sent, clock } = setup();
  q.push("gc.timeboxes", ["古い"]);
  q.push("gc.timeboxes", null);
  assert.deepEqual(sent, [["gc.timeboxes", null]]);
  clock.run();
  assert.deepEqual(sent, [["gc.timeboxes", null]], "待ちは残っていない");
});

// ------------------------------------------------------------ 送り切る／捨てる

t("flush は、待っているぶんを受け取った順に送る", () => {
  const { q, sent, clock } = setup();
  q.push("gc.habits", "h");
  q.push("gc.timeboxes", "t");
  q.flush();
  assert.deepEqual(sent, [
    ["gc.habits", "h"],
    ["gc.timeboxes", "t"],
  ]);
  assert.equal(clock.live(), 0, "タイマーは畳む");
  clock.run();
  assert.equal(sent.length, 2, "flush のあとに二重送信しない");
});

t("flush は、待ちが無ければ何もしない（何度呼んでもよい）", () => {
  const { q, sent } = setup();
  q.flush();
  q.flush();
  assert.deepEqual(sent, []);
});

t("cancel は、送らずに捨てる", () => {
  const { q, sent, clock } = setup();
  q.push("gc.timeboxes", "t");
  q.cancel();
  assert.deepEqual(q.pendingKeys(), []);
  clock.run();
  assert.deepEqual(sent, [], "取り込み後に古いローカル値を押し戻さない");
});

t("cancel のあとも、次の書き込みは普通にまとまる", () => {
  const { q, sent, clock } = setup();
  q.push("gc.timeboxes", "t1");
  q.cancel();
  q.push("gc.timeboxes", "t2");
  clock.run();
  assert.deepEqual(sent, [["gc.timeboxes", "t2"]]);
});

// ------------------------------------------------------- 繋ぎ込みが外れていないか

/*
 * 待ち行列そのものが正しくても、繋ぎ込みが外れれば
 * 「1文字ごとの全件送信」も「閉じる直前の取りこぼし」も黙って戻る。
 * どちらも動かしている本人には見えないので、文字列で見張る。
 *
 * リポジトリのパスに日本語が含まれるため fileURLToPath を通す（AGENTS.md）。
 */
const read = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

t("sync.ts は、まとめる対象を timeboxes と habits に限っている", () => {
  const src = read("src/lib/supabase/sync.ts");
  assert.ok(src.includes("createPushQueue("), "待ち行列を使っていない");
  assert.ok(
    src.includes("debounced: [KEY.timeboxes, KEY.habits]"),
    "1文字ごとに書かれるのはこの2つだけ。増やすなら理由をコメントに残すこと",
  );
});

t("sync.ts は、取り込みと切断のときに待ちを捨てている", () => {
  const src = read("src/lib/supabase/sync.ts");
  assert.equal(
    src.split("pushQueue.cancel()").length - 1,
    2,
    "disablePush と pullAll の2箇所。片方でも欠けると古い値を押し戻す",
  );
});

t("SyncBoot は、閉じる・隠す瞬間に送り切っている", () => {
  const src = read("src/components/SyncBoot.tsx");
  assert.ok(src.includes("flushPendingPushes"), "flush を呼んでいない");
  assert.ok(src.includes('"visibilitychange"'), "裏に回したときに送らない");
  assert.ok(src.includes('"pagehide"'), "iOS Safari は unload が来ない");
});

t("消す操作は、まとめ待ちを解いてから閉じられる", () => {
  const sync = read("src/lib/supabase/sync.ts");
  assert.ok(
    sync.includes("setSyncFlushHook("),
    "storage 側から待ちを解く口が繋がっていない",
  );
  const storage = read("src/lib/storage.ts");
  const from = storage.indexOf("export function deleteCard(");
  assert.ok(from > 0, "deleteCard が見つからない");
  const body = storage.slice(from, storage.indexOf("\n}", from));
  assert.ok(
    body.includes("onSyncFlushHook?.()"),
    "deleteCard が送り切っていない。1.5秒以内に閉じるとクラウドに孤児の枠が残る",
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
