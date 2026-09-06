import { addDays } from "@/lib/date";
import { decideCalendarAction } from "./decide";
import {
  deleteEvent,
  insertEvent,
  listEvents,
  patchEvent,
  refreshAccessToken,
  type GoogleEvent,
} from "./google";
import { loadLink, updateLink } from "./link";

/** 1回の同期で許す削除の上限。超えたら止めて本人に確認する */
export const DELETE_BRAKE = 5;

/** ブラウザから送られてくる枠の最小形 */
export interface SyncBoxInput {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  googleEventId?: string | null;
  updatedAt?: string;
  hasNotes: boolean;
}

/** ブラウザに返す指示 */
export interface SyncResult {
  /** 内容を書き換える枠（title/start/end/date と googleEventId のみ） */
  upserts: {
    id: string;
    title?: string;
    date?: string;
    start?: string;
    end?: string;
    googleEventId?: string | null;
  }[];
  /** 新しく取り込む枠 */
  imports: {
    title: string;
    date: string;
    start: string;
    end: string;
    googleEventId: string;
  }[];
  /** 消す枠のid */
  deletes: string[];
  /** ブレーキが働いた場合の件数。0 なら通常どおり実行済み */
  pendingDeletes: number;
}

const isGhostId = (id: string) => id.startsWith("habit-");

/** "2026-09-05" + "10:00" → RFC3339（JST固定） */
export function toRfc3339(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

/** RFC3339 → ローカル表現。終日予定（date のみ）は対象外なので null */
export function fromRfc3339(
  dt: { dateTime?: string; date?: string } | undefined,
): { date: string; time: string } | null {
  if (!dt?.dateTime) return null;
  const d = new Date(dt.dateTime);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

const markOf = (e: GoogleEvent): string | null =>
  e.extendedProperties?.private?.timeboxId ?? null;

/**
 * 同期の本体。
 *
 * 判断は decide.ts に委ね、ここは「その判断どおりに動かす」ことに徹する。
 * 途中で失敗しても、そこまでの反映は残して次回で追いつく（全か無かにしない）。
 */
export async function runSync(
  boxes: SyncBoxInput[],
  confirmDeletes: boolean,
): Promise<{ ok: true; result: SyncResult } | { ok: false; message: string }> {
  const link = await loadLink();
  if (!link) return { ok: false, message: "連携していません。" };

  let token: string;
  try {
    token = await refreshAccessToken(link.refreshToken);
  } catch {
    await updateLink({ lastError: "トークンを更新できませんでした" });
    return { ok: false, message: "連携が切れています。設定から再連携してください。" };
  }

  const timeMin = toRfc3339(addDays(-7), "00:00");
  const timeMax = toRfc3339(addDays(60), "23:59");

  // listed の型はユニオン({ok:true,...}|{ok:false,...})なので、
  // 再代入すると絞り込みが効かなくなる。確定した結果だけを別変数に持たせる
  const firstAttempt = await listEvents(token, link.calendarId, {
    syncToken: link.syncToken,
    timeMin,
    timeMax,
  });
  let listed: { ok: true; events: GoogleEvent[]; nextSyncToken: string | null };
  if (firstAttempt.ok) {
    listed = firstAttempt;
  } else {
    // syncToken が失効。全件取り直し（Googleの想定動作）
    const retried = await listEvents(token, link.calendarId, { timeMin, timeMax });
    if (!retried.ok) return { ok: false, message: "予定を取得できませんでした。" };
    listed = retried;
  }

  const events = listed.events;
  const byId = new Map(events.map((e) => [e.id, e]));
  const byMark = new Map<string, GoogleEvent>();
  for (const e of events) {
    const m = markOf(e);
    if (m) byMark.set(m, e);
  }
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const result: SyncResult = { upserts: [], imports: [], deletes: [], pendingDeletes: 0 };

  // --- まず削除の件数を数えてブレーキを判定する ---
  let deleteCount = 0;
  for (const b of boxes) {
    if (isGhostId(b.id)) continue;
    const e = b.googleEventId ? byId.get(b.googleEventId) : byMark.get(b.id);
    if (e && e.status === "cancelled" && !b.hasNotes) deleteCount++;
  }
  for (const e of events) {
    if (e.status === "cancelled") continue;
    const mark = markOf(e);
    if (mark && !boxById.has(mark)) deleteCount++;
  }
  if (deleteCount > DELETE_BRAKE && !confirmDeletes) {
    // 判定が壊れていたときに、1回で全滅させないための保険
    return { ok: true, result: { ...result, pendingDeletes: deleteCount } };
  }

  // --- アプリ側の枠を1件ずつ処理する ---
  for (const b of boxes) {
    const e = b.googleEventId ? byId.get(b.googleEventId) : byMark.get(b.id);
    const evStart = e ? fromRfc3339(e.start) : null;
    const evEnd = e ? fromRfc3339(e.end) : null;
    const contentEqual = Boolean(
      e &&
        (e.summary ?? "") === b.title &&
        evStart?.date === b.date &&
        evStart?.time === b.start &&
        evEnd?.time === b.end,
    );

    const action = decideCalendarAction({
      boxExists: true,
      boxIsGhost: isGhostId(b.id),
      boxHasNotes: b.hasNotes,
      boxUpdatedAt: b.updatedAt ?? null,
      eventState: !e ? "missing" : e.status === "cancelled" ? "cancelled" : "present",
      eventHasMark: Boolean(e && markOf(e)),
      eventUpdated: e?.updated ?? null,
      contentEqual,
    });

    try {
      if (action === "createEvent") {
        const id = await insertEvent(token, link.calendarId, {
          title: b.title,
          startIso: toRfc3339(b.date, b.start),
          endIso: toRfc3339(b.date, b.end),
          timeboxId: b.id,
        });
        result.upserts.push({ id: b.id, googleEventId: id });
      } else if (action === "updateEvent" && e) {
        await patchEvent(token, link.calendarId, e.id, {
          title: b.title,
          startIso: toRfc3339(b.date, b.start),
          endIso: toRfc3339(b.date, b.end),
          timeboxId: b.id,
        });
      } else if (action === "updateBox" && e && evStart && evEnd) {
        // カレンダーが持つのは title/start/end だけ。それ以外は絶対に触らない
        result.upserts.push({
          id: b.id,
          title: e.summary ?? "",
          date: evStart.date,
          start: evStart.time,
          end: evEnd.time,
        });
      } else if (action === "deleteBox") {
        result.deletes.push(b.id);
      }
      // keepBox / none は何もしない
    } catch (err) {
      // 1件の失敗で全体を止めない。次回の同期で追いつく
      console.error("[calendar/sync] box", b.id, err);
    }
  }

  // --- カレンダー側にしか無い予定を処理する ---
  for (const e of events) {
    const mark = markOf(e);
    if (mark && boxById.has(mark)) continue; // 上のループで見た
    const action = decideCalendarAction({
      boxExists: false,
      boxIsGhost: false,
      boxHasNotes: false,
      boxUpdatedAt: null,
      eventState: e.status === "cancelled" ? "cancelled" : "present",
      eventHasMark: Boolean(mark),
      eventUpdated: e.updated ?? null,
      contentEqual: false,
    });

    try {
      if (action === "deleteEvent") {
        await deleteEvent(token, link.calendarId, e.id);
      } else if (action === "importBox") {
        const s = fromRfc3339(e.start);
        const en = fromRfc3339(e.end);
        if (!s || !en) continue; // 終日予定は時間割に載らない
        result.imports.push({
          title: e.summary ?? "",
          date: s.date,
          start: s.time,
          end: en.time,
          googleEventId: e.id,
        });
      }
    } catch (err) {
      console.error("[calendar/sync] event", e.id, err);
    }
  }

  await updateLink({
    syncToken: listed.nextSyncToken,
    lastSyncedAt: new Date().toISOString(),
    lastError: null,
  });
  return { ok: true, result };
}
