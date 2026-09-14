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
import {
  DELETE_BRAKE,
  foldEndToSameDay,
  fromRfc3339,
  runSync,
  toRfc3339,
} from "../src/lib/calendar/engine.ts";
import { GoogleApiError } from "../src/lib/calendar/google.ts";

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
  // 固定日付だと60日を過ぎた時点で期間外に落ちて「中身ゼロで通る」ように
  // なり、再発検知が消える（レビューで指摘）。相対日付にしておく
  const day = addDays(3);
  const event = {
    id: "ev1",
    status: "confirmed",
    summary: "テスト予定",
    updated: "2026-09-01T00:00:00Z",
    start: { dateTime: `${day}T10:00:00+09:00` },
    end: { dateTime: `${day}T11:00:00+09:00` },
    extendedProperties: { private: { timeboxId: "box1" } },
  };
  const box = {
    id: "box1",
    date: day,
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

await at("#3 旧取り込み分（印の無い予定に対応する枠）は、印を付け直すだけで二重にしない", async () => {
  // 一方向になる前に専用カレンダーから取り込んだ枠。カレンダー側に印が無い。
  // 固定日付だと時間が経つと期間外に落ちて再発検知が消えるので相対日付にする
  const day = addDays(10);
  const event = {
    id: "ev2",
    status: "confirmed",
    summary: "外部予定",
    updated: "2026-09-01T00:00:00Z",
    start: { dateTime: `${day}T09:00:00+09:00` },
    end: { dateTime: `${day}T09:30:00+09:00` },
  };
  const box = {
    id: "local-999",
    date: day,
    start: "09:00",
    end: "09:30",
    title: "外部予定",
    googleEventId: "ev2",
    updatedAt: `${day}T00:00:00Z`,
    hasNotes: false,
  };
  const { deps, calls } = makeDeps([event]);
  const r = await runSync([box], false, deps);
  assert.equal(r.ok, true);
  assert.equal(calls.insert.length, 0, "作り直して二重にしてはいけない");
  assert.equal(calls.delete.length, 0, "人が作った予定を消してはいけない");
  assert.equal(calls.patch.length, 1, "印を付けるために1回だけ直す");
  assert.equal(calls.patch[0].timeboxId, "local-999");
});

await at("#3b 印の無い予定がカレンダーだけにあっても、取り込まず消さない", async () => {
  const day = addDays(10);
  const { deps, calls } = makeDeps([
    {
      id: "human",
      status: "confirmed",
      summary: "専用カレンダーで直接作った予定",
      start: { dateTime: `${day}T09:00:00+09:00` },
      end: { dateTime: `${day}T10:00:00+09:00` },
    },
  ]);
  const r = await runSync([], false, deps);
  assert.equal(r.ok, true);
  assert.equal("imports" in r.result, false, "取り込みの指示を返してはいけない");
  assert.equal(calls.delete.length + calls.insert.length + calls.patch.length, 0);
});

await at("#3c 予定IDが落ちた枠は、印で見つけてIDを付け直す（作り直さない）", async () => {
  // 2026-09-14 本番：別画面の繋ぎ直し検知でIDが一斉に消え、
  // 印の無い予定が二重になった。印付きなら付け直すだけで済むことを固定する
  const day = addDays(2);
  const { deps, calls } = makeDeps([
    {
      id: "ev-marked",
      status: "confirmed",
      summary: "今日の枠",
      start: { dateTime: `${day}T08:45:00+09:00` },
      end: { dateTime: `${day}T09:45:00+09:00` },
      extendedProperties: { private: { timeboxId: "box-lost" } },
    },
  ]);
  const r = await runSync(
    [{ id: "box-lost", date: day, start: "08:45", end: "09:45", title: "今日の枠", googleEventId: null }],
    false,
    deps,
  );
  assert.equal(r.ok, true);
  assert.equal(calls.insert.length, 0);
  assert.deepEqual(r.result.upserts, [{ id: "box-lost", googleEventId: "ev-marked" }]);
});

await at("#3d IDが古くても、自分の印の付いた生きた予定があればそれを使う", async () => {
  const day = addDays(2);
  const { deps, calls } = makeDeps([
    {
      id: "ev-new",
      status: "confirmed",
      summary: "枠",
      start: { dateTime: `${day}T10:00:00+09:00` },
      end: { dateTime: `${day}T11:00:00+09:00` },
      extendedProperties: { private: { timeboxId: "box-x" } },
    },
  ]);
  const r = await runSync(
    [{ id: "box-x", date: day, start: "10:00", end: "11:00", title: "枠", googleEventId: "ev-old" }],
    false,
    deps,
  );
  assert.equal(calls.insert.length, 0, "生きている予定と二重にしてはいけない");
  assert.deepEqual(r.result.upserts, [{ id: "box-x", googleEventId: "ev-new" }]);
});

await at("#3e 空のタイトルの枠が、同期のたびに書き直されない", async () => {
  // 空のタイトルは「（未記入）」として送っているので、同じ約束で比べる
  const day = addDays(2);
  const { deps, calls } = makeDeps([
    {
      id: "ev-empty",
      status: "confirmed",
      summary: "（未記入）",
      start: { dateTime: `${day}T14:15:00+09:00` },
      end: { dateTime: `${day}T15:15:00+09:00` },
      extendedProperties: { private: { timeboxId: "box-empty" } },
    },
  ]);
  await runSync(
    [{ id: "box-empty", date: day, start: "14:15", end: "15:15", title: "", googleEventId: "ev-empty" }],
    false,
    deps,
  );
  assert.equal(calls.patch.length, 0);
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

await at("#6 専用カレンダーで削除された枠は、アプリから消さずに作り直す", async () => {
  const day = addDays(3);
  const event = {
    id: "ev6",
    status: "cancelled",
    summary: "消された予定",
    updated: "2026-09-01T00:00:00Z",
    start: { dateTime: `${day}T10:00:00+09:00` },
    end: { dateTime: `${day}T11:00:00+09:00` },
    extendedProperties: { private: { timeboxId: "box6" } },
  };
  const box = {
    id: "box6",
    date: day,
    start: "10:00",
    end: "11:00",
    title: "消された予定",
    googleEventId: "ev6",
    updatedAt: "2026-09-01T00:00:00Z",
    hasNotes: false,
  };
  const { deps, calls } = makeDeps([event]);
  const r = await runSync([box], false, deps);
  assert.equal(r.ok, true);
  assert.equal("deletes" in r.result, false, "アプリの枠を消す指示を返してはいけない");
  assert.equal(calls.insert.length, 1, "アプリが正なので作り直す");
  assert.deepEqual(r.result.upserts, [{ id: "box6", googleEventId: "new-event-id" }]);
});

await at("#7 振り返りのある枠も同じく作り直す（消さない）", async () => {
  const day = addDays(3);
  const event = {
    id: "ev7",
    status: "cancelled",
    summary: "消された予定",
    updated: "2026-09-01T00:00:00Z",
    start: { dateTime: `${day}T10:00:00+09:00` },
    end: { dateTime: `${day}T11:00:00+09:00` },
    extendedProperties: { private: { timeboxId: "box7" } },
  };
  const box = {
    id: "box7",
    date: day,
    start: "10:00",
    end: "11:00",
    title: "消された予定",
    googleEventId: "ev7",
    updatedAt: "2026-09-01T00:00:00Z",
    hasNotes: true, // 振り返り等が書かれている
  };
  const { deps, calls } = makeDeps([event]);
  const r = await runSync([box], false, deps);
  assert.equal(r.ok, true);
  assert.equal(calls.insert.length, 1);
});

await at("#8 googleEventIdの予定が全件取得に無ければ、作り直す", async () => {
  // 全件取得なので「窓の中に該当イベントが無い」＝カレンダー側で消えた。
  // 一方向なのでアプリの枠は消さず、カレンダーに戻す
  const day = addDays(3);
  const box = {
    id: "box8",
    date: day,
    start: "10:00",
    end: "11:00",
    title: "本当は消された予定",
    googleEventId: "ev-gone",
    updatedAt: "2026-09-01T00:00:00Z",
    hasNotes: false,
  };
  const { deps, calls } = makeDeps([]); // 全件取得の結果に対応イベントが無い
  const r = await runSync([box], false, deps);
  assert.equal(r.ok, true);
  assert.equal(calls.insert.length, 1);
  assert.equal(calls.delete.length, 0);
});

t("#R3a 24:00 は翌日の00:00として送る（RFC3339に24時は無い）", () => {
  // そのまま送ると Google に弾かれるか、翌日0時へ正規化されて
  // 内容一致が永久に成立せず、枠が長さ0分に潰れていた
  assert.equal(toRfc3339("2026-09-07", "24:00"), "2026-09-08T00:00:00+09:00");
  assert.equal(toRfc3339("2026-09-30", "24:00"), "2026-10-01T00:00:00+09:00");
  assert.equal(toRfc3339("2026-12-31", "24:00"), "2027-01-01T00:00:00+09:00");
});

t("#R3b 通常の時刻はそのまま送る", () => {
  assert.equal(toRfc3339("2026-09-07", "10:00"), "2026-09-07T10:00:00+09:00");
  assert.equal(toRfc3339("2026-09-07", "00:00"), "2026-09-07T00:00:00+09:00");
});

t("#R3c 読み戻すとき、翌日0時は同じ日の24:00へ畳む", () => {
  const start = { date: "2026-09-07", time: "23:30" };
  assert.deepEqual(
    foldEndToSameDay(start, { date: "2026-09-08", time: "00:00" }),
    { date: "2026-09-07", time: "24:00" },
  );
});

t("#R3d 本当に日をまたぐ予定は畳まない", () => {
  const start = { date: "2026-09-07", time: "22:00" };
  // 翌日2時に終わる予定。24:00 ではないので触らない
  assert.deepEqual(
    foldEndToSameDay(start, { date: "2026-09-08", time: "02:00" }),
    { date: "2026-09-08", time: "02:00" },
  );
  // 2日後の0時も畳まない
  assert.deepEqual(
    foldEndToSameDay(start, { date: "2026-09-09", time: "00:00" }),
    { date: "2026-09-09", time: "00:00" },
  );
});

t("#R3e 同じ日に閉じる予定はそのまま", () => {
  const start = { date: "2026-09-07", time: "10:00" };
  assert.deepEqual(
    foldEndToSameDay(start, { date: "2026-09-07", time: "11:00" }),
    { date: "2026-09-07", time: "11:00" },
  );
});

await at("#R3f 23:30〜24:00 の枠が、同期のたびに書き換わらない", async () => {
  // 内容が一致していれば patch も upsert も起きないこと。
  // 以前はここで毎回 updateBox が走り、end に 00:00 が入って長さ0分に潰れた
  const day = addDays(3);
  const nextDay = addDays(4);
  const event = {
    id: "ev-late",
    status: "confirmed",
    summary: "夜の最後の枠",
    updated: "2026-09-01T00:00:00Z",
    start: { dateTime: `${day}T23:30:00+09:00` },
    end: { dateTime: `${nextDay}T00:00:00+09:00` },
    extendedProperties: { private: { timeboxId: "box-late" } },
  };
  const box = {
    id: "box-late",
    date: day,
    start: "23:30",
    end: "24:00",
    title: "夜の最後の枠",
    googleEventId: "ev-late",
    updatedAt: "2026-09-01T00:00:00Z",
    hasNotes: false,
  };
  const { deps, calls } = makeDeps([event]);
  const r = await runSync([box], false, deps);
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.upserts, [], "枠を書き換えている（長さ0分に潰れる経路）");
  assert.equal(calls.patch.length, 0, "カレンダー側も書き換えている");
  assert.equal(calls.insert.length, 0);
});

// --- R12 ②: 書き込み・取得・トークン更新での権限切れを「連携し直して」まで届ける ---

const newBox = (id) => ({
  id,
  date: addDays(2),
  start: "10:00",
  end: "11:00",
  title: id,
  googleEventId: null,
  updatedAt: "2026-09-01T00:00:00Z",
  hasNotes: false,
});

await at("予定の作成が401なら、needsReconnect を返し、残りの枠は叩かない", async () => {
  const { deps, calls } = makeDeps([]);
  deps.insertEvent = async (_t, _c, v) => {
    calls.insert.push(v);
    throw new GoogleApiError(401, "無効", null);
  };
  const r = await runSync([newBox("a"), newBox("b"), newBox("c")], false, deps);
  assert.equal(r.ok, true);
  assert.equal(r.result.needsReconnect, true);
  assert.equal(calls.insert.length, 1, "権限が無いと分かったあとも全件叩き続けている");
});

await at("権限不足の403（insufficientPermissions）も needsReconnect", async () => {
  const { deps } = makeDeps([]);
  deps.insertEvent = async () => {
    throw new GoogleApiError(403, "権限不足", "insufficientPermissions");
  };
  const r = await runSync([newBox("a")], false, deps);
  assert.equal(r.result.needsReconnect, true);
});

await at("混雑による403（rateLimitExceeded）は needsReconnect にしない。1件失敗として続ける", async () => {
  const { deps, calls } = makeDeps([]);
  deps.insertEvent = async (_t, _c, v) => {
    calls.insert.push(v);
    throw new GoogleApiError(403, "混雑", "rateLimitExceeded");
  };
  const r = await runSync([newBox("a"), newBox("b")], false, deps);
  assert.equal(r.ok, true);
  assert.equal(Boolean(r.result.needsReconnect), false, "再連携しても直らない案内を出してしまう");
  assert.equal(r.result.failed, 2);
  assert.equal(calls.insert.length, 2);
});

await at("素の Error（通信断など）は needsReconnect にしない", async () => {
  const { deps } = makeDeps([]);
  deps.insertEvent = async () => {
    throw new Error("network");
  };
  const r = await runSync([newBox("a")], false, deps);
  assert.equal(Boolean(r.result.needsReconnect), false);
});

await at("トークン更新が invalid_grant なら reason: reconnect_required", async () => {
  const { deps } = makeDeps([]);
  deps.refreshAccessToken = async () => {
    throw new GoogleApiError(400, "失効", "invalid_grant");
  };
  const r = await runSync([newBox("a")], false, deps);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "reconnect_required");
});

await at("トークン更新が一時的な失敗なら reason を付けない", async () => {
  const { deps } = makeDeps([]);
  deps.refreshAccessToken = async () => {
    throw new GoogleApiError(500, "障害", null);
  };
  const r = await runSync([newBox("a")], false, deps);
  assert.equal(r.ok, false);
  assert.equal(r.reason, undefined);
});

await at("予定の取得が401なら reason: reconnect_required（例外で500にしない）", async () => {
  const { deps } = makeDeps([]);
  deps.listEvents = async () => {
    throw new GoogleApiError(401, "無効", null);
  };
  const r = await runSync([newBox("a")], false, deps);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "reconnect_required");
});

await at("予定の取得が権限以外の失敗なら、これまでどおり例外を投げる", async () => {
  const { deps } = makeDeps([]);
  deps.listEvents = async () => {
    throw new GoogleApiError(503, "障害", "backendError");
  };
  await assert.rejects(() => runSync([newBox("a")], false, deps));
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
