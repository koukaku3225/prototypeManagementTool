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
  /** Google API呼び出しに失敗した件数。0件でなければ lastError に残す */
  failed: number;
}

const isGhostId = (id: string) => id.startsWith("habit-");

/** "2026-09-05" + "10:00" → RFC3339（JST固定） */
export function toRfc3339(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

/**
 * RFC3339 → ローカル表現。終日予定（date のみ）は対象外なので null。
 *
 * `new Date(...).getHours()` はサーバーのタイムゾーンを見る。
 * ローカル開発機は JST だから気づけないが、Vercel の既定タイムゾーンは UTC
 * なので、本番でだけ時刻が9時間ずれる（レビューで実際に指摘された）。
 * `Intl.DateTimeFormat` に `timeZone: "Asia/Tokyo"` を明示することで、
 * 実行環境のタイムゾーンに関係なく常にJSTの時刻を取り出す。
 */
const JST_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function fromRfc3339(
  dt: { dateTime?: string; date?: string } | undefined,
): { date: string; time: string } | null {
  if (!dt?.dateTime) return null;
  const d = new Date(dt.dateTime);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(
    JST_FORMAT.formatToParts(d).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  // 環境によって深夜0時が "24" で返ることがあるので丸める
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
  };
}

const markOf = (e: GoogleEvent): string | null =>
  e.extendedProperties?.private?.timeboxId ?? null;

/** runSync が呼ぶ外部依存。テストではモックに差し替える */
export interface SyncDeps {
  loadLink: typeof loadLink;
  updateLink: typeof updateLink;
  refreshAccessToken: typeof refreshAccessToken;
  listEvents: typeof listEvents;
  insertEvent: typeof insertEvent;
  patchEvent: typeof patchEvent;
  deleteEvent: typeof deleteEvent;
}

const defaultDeps: SyncDeps = {
  loadLink,
  updateLink,
  refreshAccessToken,
  listEvents,
  insertEvent,
  patchEvent,
  deleteEvent,
};

/**
 * `b.googleEventId` で引いた予定を採用してよいか判定する。
 *
 * 印（timeboxId）が付いていて、それが自分（b.id）以外を指しているなら、
 * 別の枠が作った予定を誤って掴んでいる（IDの使い回し・データ不整合など）。
 * それを採用すると `patchEvent` で他人の印を上書きしてしまうので、
 * 印が無いか自分の印のときだけ採用する。
 */
function ownedEvent(
  byId: Map<string, GoogleEvent>,
  byMark: Map<string, GoogleEvent>,
  b: SyncBoxInput,
): GoogleEvent | undefined {
  if (b.googleEventId) {
    const cand = byId.get(b.googleEventId);
    if (!cand) return undefined;
    const mark = markOf(cand);
    if (mark && mark !== b.id) return undefined;
    return cand;
  }
  return byMark.get(b.id);
}

/**
 * 枠に対応するイベントの状態を判定する。
 *
 * 差分取得（syncToken）をやめて毎回この期間を全件取得するようにしたので、
 * 「一度送った googleEventId が、今回の全件取得結果に一件も無い」こと自体が
 * 「カレンダー側で削除された」証拠として使える。差分取得のままだと
 * 変更の無いイベントがそもそも結果に含まれないため、この判定はできなかった
 * （消えたのか単に変更が無かっただけなのか区別できない）。
 *
 * b.googleEventId が null（まだ一度もカレンダーに送っていない枠）は、
 * 単に「これから作る」だけなので missing のまま。
 */
function eventStateOf(
  byId: Map<string, GoogleEvent>,
  b: SyncBoxInput,
  e: GoogleEvent | undefined,
): "missing" | "present" | "cancelled" {
  if (e) return e.status === "cancelled" ? "cancelled" : "present";
  if (b.googleEventId && !byId.has(b.googleEventId)) return "cancelled";
  return "missing";
}

/**
 * 同期の本体。
 *
 * 判断は decide.ts に委ね、ここは「その判断どおりに動かす」ことに徹する。
 * 途中で失敗しても、そこまでの反映は残して次回で追いつく（全か無かにしない）。
 */
export async function runSync(
  boxes: SyncBoxInput[],
  confirmDeletes: boolean,
  deps: SyncDeps = defaultDeps,
): Promise<{ ok: true; result: SyncResult } | { ok: false; message: string }> {
  const link = await deps.loadLink();
  if (!link) return { ok: false, message: "連携していません。" };

  let token: string;
  try {
    token = await deps.refreshAccessToken(link.refreshToken);
  } catch {
    await deps.updateLink({ lastError: "トークンを更新できませんでした" });
    return { ok: false, message: "連携が切れています。設定から再連携してください。" };
  }

  const fromDate = addDays(-7);
  const toDate = addDays(60);
  const timeMin = toRfc3339(fromDate, "00:00");
  const timeMax = toRfc3339(toDate, "23:59");

  // 差分取得（syncToken）はやめて、毎回この期間を全件取得する。
  // syncToken を使うと「前回以降に変更のあった予定だけ」しか返らないのに、
  // 以前の実装はそれを「期間内の全予定」として扱っていた。
  // 変更の無かった枠は byId/byMark に引っかからず missing 扱いになり、
  // 同期のたびに createEvent が起きて予定が増殖していた（レビューで指摘）。
  // 全件取得なら毎回同じ状態から突き合わせるので、この事故は起きない。
  const listed = await deps.listEvents(token, link.calendarId, { timeMin, timeMax });
  if (!listed.ok) {
    // ここで lastError を更新しないと、取得失敗が握りつぶされて
    // 「同期が止まっているのに誰も気づけない」状態になる（レビューで指摘）
    await deps.updateLink({ lastError: "予定を取得できませんでした" });
    return { ok: false, message: "予定を取得できませんでした。" };
  }

  const events = listed.events;
  const byId = new Map(events.map((e) => [e.id, e]));
  const byMark = new Map<string, GoogleEvent>();
  for (const e of events) {
    const m = markOf(e);
    if (m) byMark.set(m, e);
  }

  // 期間外の枠を混ぜると「対応する予定が events に無い→作る→作った予定は
  // 期間外なので次回もまた見えない→また作る」という重複作成が起きる
  // （レビューで指摘）。取得した期間とアプリ側の対象を必ず揃える。
  const inWindow = boxes.filter((b) => b.date >= fromDate && b.date <= toDate);
  const boxById = new Map(inWindow.map((b) => [b.id, b]));
  const result: SyncResult = {
    upserts: [],
    imports: [],
    deletes: [],
    pendingDeletes: 0,
    failed: 0,
  };

  // --- まず削除の件数を数えてブレーキを判定する ---
  let deleteCount = 0;
  for (const b of inWindow) {
    if (isGhostId(b.id)) continue;
    const e = ownedEvent(byId, byMark, b);
    if (eventStateOf(byId, b, e) === "cancelled" && !b.hasNotes) deleteCount++;
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

  // 第1ループで対応づけた予定のidを記録しておく。
  // 第2ループは印（timeboxId）だけで判定していたが、googleEventId 経由で
  // 対応づいた予定（＝印の無い、人がカレンダーで作った予定を取り込んだもの）
  // が漏れて、毎回二重取り込みされていた（レビューで指摘）。
  const handledEventIds = new Set<string>();

  // --- アプリ側の枠を1件ずつ処理する ---
  for (const b of inWindow) {
    const e = ownedEvent(byId, byMark, b);
    if (e) handledEventIds.add(e.id);
    const evStart = e ? fromRfc3339(e.start) : null;
    const evEnd = e ? fromRfc3339(e.end) : null;
    const contentEqual = Boolean(
      e &&
        (e.summary ?? "") === b.title &&
        evStart?.date === b.date &&
        evStart?.time === b.start &&
        evEnd?.date === b.date &&
        evEnd?.time === b.end,
    );

    const action = decideCalendarAction({
      boxExists: true,
      boxIsGhost: isGhostId(b.id),
      boxHasNotes: b.hasNotes,
      boxUpdatedAt: b.updatedAt ?? null,
      eventState: eventStateOf(byId, b, e),
      eventHasMark: Boolean(e && markOf(e)),
      eventUpdated: e?.updated ?? null,
      contentEqual,
    });

    try {
      if (action === "createEvent") {
        const id = await deps.insertEvent(token, link.calendarId, {
          title: b.title,
          startIso: toRfc3339(b.date, b.start),
          endIso: toRfc3339(b.date, b.end),
          timeboxId: b.id,
        });
        result.upserts.push({ id: b.id, googleEventId: id });
      } else if (action === "updateEvent" && e) {
        await deps.patchEvent(token, link.calendarId, e.id, {
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
      result.failed++;
    }
  }

  // --- カレンダー側にしか無い予定を処理する ---
  for (const e of events) {
    if (handledEventIds.has(e.id)) continue; // 上のループで見た
    const mark = markOf(e);
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
        await deps.deleteEvent(token, link.calendarId, e.id);
      } else if (action === "importBox") {
        const s = fromRfc3339(e.start);
        const en = fromRfc3339(e.end);
        if (!s || !en) continue; // 終日予定は時間割に載らない
        if (s.date !== en.date) continue; // TimeBoxは日をまたぐ枠を表現できない
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
      result.failed++;
    }
  }

  await deps.updateLink({
    // 差分取得をやめたので、以後 syncToken は使わない。null にして
    // 「これはもう使っていない」ことを明示する
    syncToken: null,
    lastSyncedAt: new Date().toISOString(),
    lastError: result.failed > 0 ? `${result.failed}件の同期に失敗しました` : null,
  });
  return { ok: true, result };
}
