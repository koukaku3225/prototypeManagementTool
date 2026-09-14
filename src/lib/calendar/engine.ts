import { addDays } from "@/lib/date";
import { decideCalendarAction } from "./decide";
import {
  deleteEvent,
  insertEvent,
  listEvents,
  needsReconnect,
  patchEvent,
  refreshAccessToken,
  type GoogleEvent,
} from "./google";
import { loadLink, updateLink } from "./link";
import { foldEndToSameDay, fromRfc3339, toRfc3339 } from "./time";

// 時刻の変換は time.ts へ移した。既存の import（overlay ルート・テスト）のために再輸出する
export { foldEndToSameDay, fromRfc3339, toRfc3339 };

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
  /** 一方向になってからは使わない。古い画面が送ってきても弾かないよう残す */
  updatedAt?: string;
  hasNotes?: boolean;
}

/**
 * ブラウザに返す指示。
 *
 * 専用カレンダーは「アプリ → Google」の一方向なので（decide.ts）、
 * アプリの枠に書き戻すのは予定IDの対応だけ。タイトル・時刻・削除は返さない。
 */
export interface SyncResult {
  /** 予定IDを付け直す枠 */
  upserts: { id: string; googleEventId: string }[];
  /** ブレーキが働いた場合の件数。0 なら通常どおり実行済み */
  pendingDeletes: number;
  /** Google API呼び出しに失敗した件数。0件でなければ lastError に残す */
  failed: number;
  /**
   * 書き込みの途中で「連携し直さないと直らない」失敗が起きた（R12）。
   * そこで打ち切っている。画面は「連携し直してください」を出す。
   */
  needsReconnect?: boolean;
  /**
   * 1回の同期で行う Google への書き込みが上限（MAX_WRITE_OPS）に達し、
   * 残りを次回に回した。送れなかった枠は googleEventId が付かないまま残るので、
   * 次の同期で続きから作られる。
   */
  truncated?: boolean;
}

/**
 * 1回の同期で Google へ書き込む（作成・更新・削除）件数の上限。
 *
 * 以前は上限が無く、500件の枠を送る1回の要求が500回の API 呼び出しになった
 * （セキュリティレビュー指摘12）。盗まれたセッションや壊れたクライアントから、
 * 共有プロジェクトのクォータと関数の実行時間を消費できた。
 * 普段の同期はせいぜい数件なので、本人の操作では当たらない値にしてある。
 */
export const MAX_WRITE_OPS = 100;

/** 同期が丸ごと失敗した理由。reconnect_required のときだけ画面が再連携を案内する */
export type SyncFailure = { ok: false; message: string; reason?: "reconnect_required" };

const isGhostId = (id: string) => id.startsWith("habit-");

/** 空のタイトルを送るときの表記。google.ts の eventBody と揃える */
const EMPTY_TITLE = "（未記入）";

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
  const marked = byMark.get(b.id);
  if (b.googleEventId) {
    const cand = byId.get(b.googleEventId);
    const mark = cand ? markOf(cand) : null;
    if (cand && (!mark || mark === b.id) && cand.status !== "cancelled") return cand;
    /*
     * IDで引けない・消されていても、自分の印が付いた生きた予定があればそれを使う。
     * 以前は ID を持っている枠は印を見なかったので、ID が古くなると
     * 「消された → 作り直す」になり、生きている予定と二重になりえた。
     */
    if (marked && marked.status !== "cancelled") return marked;
    return cand && (!mark || mark === b.id) ? cand : undefined;
  }
  return marked;
}

/**
 * 枠に対応するイベントの状態を判定する。
 *
 * 差分取得（syncToken）をやめて毎回この期間を全件取得するようにしたので、
 * 「一度送った googleEventId が、今回の全件取得結果に一件も無い」ことを
 * 「カレンダー側で削除された」証拠として使える。
 *
 * ただしこれが成り立つのは **googleEventId が今つないでいるカレンダーの
 * ものである限り**。別のカレンダーへ再連携すると、新しいカレンダーには
 * どのIDも無いので、全部の枠が「削除された」と判定されてしまう。
 * その切り分けはここではできない（どのカレンダーのIDかを知らない）ので、
 * 再連携を検知して googleEventId を落とす役目は呼び出し側に持たせている
 * （`clearEventIdsIfCalendarChanged` / CalendarSyncBoot）。
 * ここへ来る時点で、IDは現在のカレンダーのものだけになっている前提。
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
): Promise<{ ok: true; result: SyncResult } | SyncFailure> {
  const link = await deps.loadLink();
  if (!link) return { ok: false, message: "連携していません。" };

  let token: string;
  try {
    token = await deps.refreshAccessToken(link.refreshToken);
  } catch (err) {
    await deps.updateLink({ lastError: "トークンを更新できませんでした" });
    return {
      ok: false,
      message: "連携が切れています。設定から再連携してください。",
      // 失効（invalid_grant）など、連携し直さないと直らないときだけ画面に案内させる
      ...(needsReconnect(err) ? { reason: "reconnect_required" as const } : {}),
    };
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
  let listed: Awaited<ReturnType<typeof deps.listEvents>>;
  try {
    listed = await deps.listEvents(token, link.calendarId, { timeMin, timeMax });
  } catch (err) {
    /*
     * 権限切れは例外のまま投げると、ルートの catch で「時間をおいて試して」に
     * 丸められ、何度待っても直らない（R12）。ここで理由として返す。
     * それ以外（障害など）は、これまでどおり投げる。
     */
    if (!needsReconnect(err)) throw err;
    await deps.updateLink({ lastError: "予定を読む許可がありません" });
    return { ok: false, message: "連携し直してください。", reason: "reconnect_required" };
  }
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
    pendingDeletes: 0,
    failed: 0,
  };

  // --- まず削除の件数を数えてブレーキを判定する ---
  // 消すのは「アプリで消された枠の予定（印付き）」だけ。アプリの枠は消さない
  let deleteCount = 0;
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

  /** 書き込みを1件使う。上限に達していたら false（その操作は次回に回す） */
  let writeOps = 0;
  const spendWrite = (): boolean => {
    if (writeOps >= MAX_WRITE_OPS) {
      result.truncated = true;
      return false;
    }
    writeOps++;
    return true;
  };

  // --- アプリ側の枠を1件ずつ処理する ---
  for (const b of inWindow) {
    const e = ownedEvent(byId, byMark, b);
    if (e) handledEventIds.add(e.id);
    const evStart = e ? fromRfc3339(e.start) : null;
    // 送るときに 24:00 を翌日0時へ直しているので、読むときは畳み直す
    const evEnd = foldEndToSameDay(evStart, e ? fromRfc3339(e.end) : null);
    const contentEqual = Boolean(
      e &&
        // 空のタイトルは「（未記入）」として送っている（google.ts の eventBody）。
        // 同じ約束で比べないと、空の枠が同期のたびに書き直される
        (e.summary ?? "") === (b.title || EMPTY_TITLE) &&
        evStart?.date === b.date &&
        evStart?.time === b.start &&
        evEnd?.date === b.date &&
        evEnd?.time === b.end,
    );

    const action = decideCalendarAction({
      boxExists: true,
      boxIsGhost: isGhostId(b.id),
      eventState: eventStateOf(byId, b, e),
      eventHasMark: Boolean(e && markOf(e)),
      contentEqual,
    });

    /*
     * 予定IDが落ちていても、印で予定を見つけられたら付け直す（書き込みは要らない）。
     * 付け直さないと、別端末の繋ぎ直し検知などでIDが消えた枠が、
     * 永久にIDなしのまま残る（2026-09-14 の実機検証で今日の枠がそうなった）。
     */
    if (
      e &&
      e.status !== "cancelled" &&
      action !== "createEvent" &&
      b.googleEventId !== e.id
    ) {
      result.upserts.push({ id: b.id, googleEventId: e.id });
    }

    if ((action === "createEvent" || (action === "updateEvent" && e)) && !spendWrite()) {
      continue;
    }

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
      }
      // none は何もしない
    } catch (err) {
      console.error("[calendar/sync] box", b.id, err);
      result.failed++;
      /*
       * 権限切れは1件ごとに違う結果にならない。残りを叩き続けても全部同じ理由で
       * 失敗するだけなので打ち切り、画面に「連携し直して」を出させる（R12）。
       * 混雑などの一時的な失敗は、これまでどおり1件の失敗として続ける。
       */
      if (needsReconnect(err)) {
        result.needsReconnect = true;
        break;
      }
    }
  }

  // --- カレンダー側にしか無い予定を処理する ---
  for (const e of result.needsReconnect ? [] : events) {
    if (handledEventIds.has(e.id)) continue; // 上のループで見た
    const mark = markOf(e);
    const action = decideCalendarAction({
      boxExists: false,
      boxIsGhost: false,
      eventState: e.status === "cancelled" ? "cancelled" : "present",
      eventHasMark: Boolean(mark),
      contentEqual: false,
    });

    if (action === "deleteEvent" && !spendWrite()) continue;

    try {
      if (action === "deleteEvent") {
        await deps.deleteEvent(token, link.calendarId, e.id);
      }
      // 印の無い予定は取り込まない。予定を入れる入口はメインカレンダー（primary.ts）
    } catch (err) {
      console.error("[calendar/sync] event", e.id, err);
      result.failed++;
      if (needsReconnect(err)) {
        result.needsReconnect = true;
        break;
      }
    }
  }

  await deps.updateLink({
    // 差分取得をやめたので、以後 syncToken は使わない。null にして
    // 「これはもう使っていない」ことを明示する
    syncToken: null,
    lastSyncedAt: new Date().toISOString(),
    lastError: result.needsReconnect
      ? "カレンダーへ書き込む許可がありません"
      : result.failed > 0
        ? `${result.failed}件の同期に失敗しました`
        : null,
  });
  return { ok: true, result };
}
