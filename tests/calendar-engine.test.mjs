/**
 * 同期エンジン（engine.ts）のテスト。
 *
 * decide.ts の判断は calendar-decide.test.mjs で総当たり済みだが、
 * 判断を「どう実行するか」の配線側にレビューでCriticalが4件見つかった
 * （差分取得での増殖・タイムゾーン起因の9時間ズレ・二重取り込み・
 * 期間外の重複作成）。判断ロジックが正しくても配線を間違えると事故になる
 * ことが実証されたので、ここで固定する。
 *
 * TZ設定について: 2つ目のテストはサーバーのタイムゾーンに依存しない
 * ことを確かめるためのもの。`process.env.TZ` は import 前に設定すれば
 * 効くのが通常だが、環境によっては効かないこともある。fromRfc3339 は
 * Intl.DateTimeFormat に timeZone: "Asia/Tokyo" を明示しているため、
 * どちらにせよ結果は変わらない（＝このテストは常に通る設計になっている）。
 *
 * 実行は `npm test`。
 */
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { addDays } from "../src/lib/date.ts";
import { DELETE_BRAKE, fromRfc3339, runSync } from "../src/lib/calendar/engine.ts";

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

async function at(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}

const LINK = {
  userId: "u1",
  refreshToken: "rt",
  calendarId: "cal1",
  syncToken: null,
  lastSyncedAt: null,
  lastError: null,
};

/** テスト用のモック依存。呼び出しを配列に記録する */
function makeDeps(events) {
  const calls = { insert: [], patch: [], delete: [], updateLink: [] };
  const deps = {
    loadLink: async () => LINK,
    updateLink: async (v) => {
      calls.updateLink.push(v);
    },
    refreshAccessToken: async () => "access-token",
    listEvents: async () => ({ ok: true, events, nextSyncToken: null }),
    insertEvent: async (_token, _cal, v) => {
      calls.insert.push(v);
      return "new-event-id";
    },
    patchEvent: async (_token, _cal, eventId, v) => {
      calls.patch.push({ eventId, ...v });
    },
    deleteEvent: async (_token, _cal, eventId) => {
      calls.delete.push(eventId);
    },
  };
  return { deps, calls };
}

t("#1 時刻変換はサーバーのタイムゾーンに依存しない", () => {
  assert.deepEqual(
    fromRfc3339({ dateTime: "2026-09-05T10:00:00+09:00" }),
    { date: "2026-09-05", time: "10:00" },
  );
});

await at("#2 内容が一致していれば2回目の同期で作り直さない", async () => {
  const event = {
    id: "ev1",
    status: "confirmed",
    summary: "テスト予定",
    updated: "2026-09-01T00:00:00Z",
    start: { dateTime: "2026-09-10T10:00:00+09:00" },
    end: { dateTime: "2026-09-10T11:00:00+09:00" },
    extendedProperties: { private: { timeboxId: "box1" } },
  };
  const box = {
    id: "box1",
    date: "2026-09-10",
    start: "10:00",
    end: "11:00",
    title: "テスト予定",
    googleEventId: "ev1",
    updatedAt: "2026-09-01T00:00:00Z",
    hasNotes: false,
  };
  const { deps, calls } = makeDeps([event]);
  // C-1（差分取得のせいで毎回全件が重複作成される）の再発検知。
  // syncToken を渡すと「変更のあった予定だけ」しか返らないのに、
  // エンジンはそれを「期間内の全予定」として扱うため、2回目以降
  // 内容が変わっていない枠まですべて重複作成されてしまう。
  // モックの戻り値を差し替えるだけでは実装側の退行を検知できないので、
  // 呼び出し引数に syncToken が含まれていないことを直接確認する。
  // LINK.syncToken は null なので、もし実装が単に link.syncToken を
  // そのまま渡すようになっても null==null で見逃してしまう。
  // ここだけ非nullの値を持つ連携情報にして、渡されたら必ず引っかかるようにする
  deps.loadLink = async () => ({ ...LINK, syncToken: "stale-sync-token" });
  const originalListEvents = deps.listEvents;
  deps.listEvents = async (token, calendarId, opts) => {
    assert.ok(
      !opts || !("syncToken" in opts) || opts.syncToken == null,
      "listEvents に syncToken を渡してはいけない（差分取得は廃止した）",
    );
    return originalListEvents(token, calendarId, opts);
  };
  const r = await runSync([box], false, deps);
  assert.equal(r.ok, true);
  assert.equal(calls.insert.length, 0, "insertEventが呼ばれてはいけない");
  assert.equal(calls.patch.length, 0, "patchEventが呼ばれてはいけない");
});

await at("#3 印の無い予定を取り込んだあと、二重取り込みされない", async () => {
  // 1回目の同期で取り込まれ、アプリ側の枠に googleEventId が付いた状態を再現する。
  // カレンダー側は人が作った予定なので extendedProperties（印）は無いまま。
  const event = {
    id: "ev2",
    status: "confirmed",
    summary: "外部予定",
    updated: "2026-09-01T00:00:00Z",
    start: { dateTime: "2026-09-15T09:00:00+09:00" },
    end: { dateTime: "2026-09-15T09:30:00+09:00" },
  };
  const box = {
    id: "local-999",
    date: "2026-09-15",
    start: "09:00",
    end: "09:30",
    title: "外部予定",
    googleEventId: "ev2",
    updatedAt: "2026-09-15T00:00:00Z",
    hasNotes: false,
  };
  const { deps, calls } = makeDeps([event]);
  const r = await runSync([box], false, deps);
  assert.equal(r.ok, true);
  assert.equal(r.result.imports.length, 0, "再取り込みされてはいけない");
  assert.equal(calls.delete.length, 0, "人が作った予定を消してはいけない");
});

await at("#4 期間外の枠は処理されない", async () => {
  const box = {
    id: "outside1",
    date: addDays(-8), // 取得範囲は -7日〜+60日
    start: "09:00",
    end: "10:00",
    title: "圏外",
    hasNotes: false,
  };
  const { deps, calls } = makeDeps([]);
  const r = await runSync([box], false, deps);
  assert.equal(r.ok, true);
  assert.equal(calls.insert.length, 0, "期間外の枠でinsertEventが呼ばれてはいけない");
  assert.equal(r.result.upserts.length, 0);
});

await at("#5 削除ブレーキが働くとAPI呼び出しが1件も起きない", async () => {
  // ブレーキ閾値(5)を超える6件。すべて「アプリに存在しない印付き予定」＝
  // 通常ならカレンダー側から削除される対象にする
  const events = Array.from({ length: DELETE_BRAKE + 1 }, (_, i) => ({
    id: `ev${i}`,
    status: "confirmed",
    summary: "消えるはずの予定",
    updated: "2026-09-01T00:00:00Z",
    start: { dateTime: "2026-09-10T10:00:00+09:00" },
    end: { dateTime: "2026-09-10T11:00:00+09:00" },
    extendedProperties: { private: { timeboxId: `missing-box-${i}` } },
  }));
  const { deps, calls } = makeDeps(events);
  const r = await runSync([], false, deps);
  assert.equal(r.ok, true);
  assert.equal(r.result.pendingDeletes, DELETE_BRAKE + 1);
  assert.equal(calls.delete.length, 0, "deleteEventが呼ばれてはいけない");
  assert.equal(calls.insert.length, 0, "insertEventが呼ばれてはいけない");
  assert.equal(calls.patch.length, 0, "patchEventが呼ばれてはいけない");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
