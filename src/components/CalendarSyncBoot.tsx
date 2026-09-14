"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addDays } from "@/lib/date";
import {
  deleteTimeBoxes,
  loadAllTimeBoxes,
  loadTimeBoxes,
  readDeviceFlag,
  upsertTimeBox,
  upsertTimeBoxes,
  writeDeviceFlag,
} from "@/lib/storage";
import {
  applyCalendarReconnect,
  LAST_CALENDAR_KEY,
  nextReconnectFlag,
  type ReconnectEvent,
} from "@/lib/calendar/reconnect";
import { isFromGoogle, mergePrimary, type PrimaryFetch } from "@/lib/calendar/primary";
import { DEVICE_KEY } from "@/lib/storage-keys";
import { getSyncState } from "@/lib/supabase/sync";

/**
 * メインカレンダーの予定を取り込む（calendar/primary.ts）。変わった件数を返す。
 *
 * 読めなかったとき（未連携・通信断・権限切れ）は何もしない。
 * 「読めなかった」を「予定が0件」と取り違えると、取り込んだ枠を全部消してしまう。
 */
async function importPrimary(): Promise<{ changed: number; reconnect: boolean }> {
  const data = await fetch("/api/calendar/primary")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!data?.ok || !Array.isArray(data.events) || !data.from || !data.to) {
    return { changed: 0, reconnect: data?.reason === "reconnect_required" };
  }
  const fetched: PrimaryFetch = { from: data.from, to: data.to, events: data.events };
  // 非表示の行も渡す。渡さないと、消した予定を取り込み直してしまう
  const { upserts, deletes, braked } = mergePrimary(
    loadAllTimeBoxes(),
    fetched,
    new Date().toISOString(),
  );
  if (braked) {
    console.warn(
      "[calendar] Googleで一度に多くの予定が消えていたので、消さずに「Googleで削除済み」にしました",
    );
  }
  upsertTimeBoxes(upserts);
  deleteTimeBoxes(deletes);
  return { changed: upserts.length + deletes.length, reconnect: false };
}

// サーバー側の取得窓は -7日〜+60日だが、送信側はそれより広め（-14〜+90）に
// 絞る。窓をぴったり合わせると、サーバーとクライアントで「今日」の算出が
// 1日ずれただけで境界の枠が送信対象から漏れ、同期対象から抜け落ちる
// （境界の取りこぼしを避けるための余裕）。
const SEND_FROM_DAYS = -14;
const SEND_TO_DAYS = 90;

/**
 * 時間割を開いたときに1度だけカレンダーと突き合わせる。
 *
 * 【不変条件】Supabase同期の向きが決着するまで走らせない。
 * まっさらな端末で走ると「全部アプリで消された」と誤判定して
 * カレンダー側を空にする。クラウド同期で実際に踏んだ形の事故なので、
 * ここで明示的に止める。
 *
 * 【注意】この effect は `onApplied` が毎レンダーで新しい関数になることに
 * 依存して「まだ走っていないか」を ready 判定と ran ref だけで賄っている。
 * 呼び出し側が `onApplied` を `useCallback` で包んでも壊れはしないが、
 * 依存配列に入れている以上は挙動を変える可能性があるので、包む場合は
 * このコンポーネントの動作を必ず確認すること。
 */
/** 「連携し直してください」の印を、同期の結果で更新する（R12 ②） */
function markReconnect(event: ReconnectEvent): void {
  writeDeviceFlag(
    DEVICE_KEY.calendarNeedsReconnect,
    nextReconnectFlag(readDeviceFlag(DEVICE_KEY.calendarNeedsReconnect), event),
  );
}

export function CalendarSyncBoot({
  onApplied,
  onReconnectChange,
}: {
  onApplied: () => void;
  /** 印を書き換えたあとに呼ぶ。画面の案内を読み直させる */
  onReconnectChange?: () => void;
}) {
  const ran = useRef(false);
  const [pending, setPending] = useState(0);

  const runSync = useCallback(async (confirmDeletes: boolean) => {
    /*
     * 先にメインカレンダーを取り込む。専用カレンダーの繋ぎ直しとは関係が無い
     * （予定IDはメインカレンダーのもの）ので、下の「見送り」に巻き込まない。
     * 取り込んだ枠は source="google" なので、下の専用カレンダーへの送信には入らない。
     */
    const primary = await importPrimary();
    if (primary.reconnect) {
      markReconnect("overlay_reconnect");
      onReconnectChange?.();
    }
    if (primary.changed > 0) onApplied();

    /*
     * 送る前に「繋ぎ直していないか」を確かめる。
     *
     * 別のカレンダーへ繋ぎ直すと、新しいカレンダーには古い予定IDが
     * 一つも無い。サーバー側はそれを「削除された」と判定するので、
     * 落としておかないと時間割が消える（5件までは無言で消える）。
     * 状態を取れなければ触らない＝落とさない、で安全側に倒す。
     */
    const status = await fetch("/api/calendar/status")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    const currentCalendarId: string | null = status?.calendarId ?? null;
    const currentConnectedAt: string | null = status?.connectedAt ?? null;

    /*
     * 繋ぎ直しの後始末は、送信データではなく localStorage 本体に対して
     * 行う。送信は期間で絞るので、送るデータの中だけで落としても
     * 「+60日より先の枠」と「作り直しに失敗した枠」に古いIDが残り、
     * それが処理窓に入った日に一言もなく消える（2026-09-08 指摘1）。
     * 目印の更新もこの中で済む。
     */
    const {
      changed: reconnected,
      suspicious,
      cleared,
      failed: clearFailed,
    } = applyCalendarReconnect({
      currentCalendarId,
      currentConnectedAt,
      storage: {
        loadAll: loadTimeBoxes,
        save: upsertTimeBox,
        readFlag: () => readDeviceFlag(LAST_CALENDAR_KEY),
        writeFlag: (v) => writeDeviceFlag(LAST_CALENDAR_KEY, v),
      },
    });
    /*
     * カレンダーIDが変わったのに、連携を作り直した形跡が無い（R12 ①）。
     * このまま送ると、古いIDを「削除された」と判定されて枠が消えるか、
     * 落とせば重複予定が作られる。どちらも取り返しがつかないので、この回は送らない。
     * 目印は書いていないので、状態が戻れば次に開いたときふつうに同期する。
     */
    if (suspicious) {
      console.warn(
        "[calendar] 連携先のカレンダーIDが変わりましたが、連携し直した形跡がありません。念のため今回の同期を見送ります",
      );
      return;
    }
    if (reconnected) {
      console.warn(
        `[calendar] 連携先のカレンダーが変わったので、古い予定IDを${cleared}件落として作り直します`,
      );
    }
    /*
     * 容量超過などで落とし切れなかったぶん。目印は書かれていないので、
     * 次に時間割を開いたときにもう一度やり直す。送信は続けてよい
     * （古いIDが残った枠は作り直されず、次回の再試行に回るだけ）。
     */
    if (clearFailed > 0) {
      console.warn(
        `[calendar] 古い予定IDを${clearFailed}件落とせませんでした（保存に失敗）。次回やり直します`,
      );
    }

    const from = addDays(SEND_FROM_DAYS);
    const to = addDays(SEND_TO_DAYS);
    // 上でIDを落としてあるので、ここで読み直せば「現在のカレンダーのIDだけ」になる
    const boxes = loadTimeBoxes()
      // 全件送るとAPIスキーマの上限（500件）を超えて弾かれ、以後同期が
      // 恒久的に止まる（レビューで指摘）。期間で絞って送信する
      .filter((b) => b.date >= from && b.date <= to)
      // メインカレンダーから取り込んだ枠は送らない。送ると専用カレンダーに
      // 同じ予定が写り、Google 上で二重に並ぶ
      .filter((b) => !isFromGoogle(b))
      .map((b) => ({
        id: b.id,
        date: b.date,
        start: b.start,
        end: b.end,
        title: b.title,
        googleEventId: b.googleEventId ?? null,
      }));

    const res = await fetch("/api/calendar/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boxes, confirmDeletes }),
    }).catch(() => null);
    // 通信できなくても時間割は普通に使える
    if (!res) return;
    const data = await res.json().catch(() => null);
    if (!data?.ok) {
      // 連携し直さないと直らない失敗だけ案内する。混雑・通信断では印を付けない
      if (data?.reason === "reconnect_required") {
        markReconnect("sync_reconnect");
        onReconnectChange?.();
      }
      return;
    }
    // 途中で権限切れを踏んで打ち切った／最後まで送れた。どちらでも印を更新する
    markReconnect(data.needsReconnect ? "sync_reconnect" : "sync_ok");
    onReconnectChange?.();

    if (data.pendingDeletes > 0) {
      setPending(data.pendingDeletes);
      return;
    }
    setPending(0);

    /*
     * 目印はもう applyCalendarReconnect が書いている。ここでは書かない。
     *
     * 以前はここ（送信成功後）で書いていたが、それだと同期に一度も
     * 成功していない端末で目印が null のままになり、次に繋ぎ直しても
     * 検知できなかった。落とす対象が localStorage 本体になったので、
     * 「送信の成否」と「目印を書いてよいか」は無関係になっている。
     */

    /*
     * 専用カレンダーは一方向なので、返ってくるのは予定IDの対応だけ。
     * タイトル・時刻・書き込みには触らない（元の枠を展開して ID だけ差し替える）。
     */
    const all = loadTimeBoxes();
    const idFixes = (data.upserts ?? []).flatMap((u: { id: string; googleEventId?: string }) => {
      const cur = all.find((b) => b.id === u.id);
      return cur && u.googleEventId ? [{ ...cur, googleEventId: u.googleEventId }] : [];
    });
    upsertTimeBoxes(idFixes);
    if (idFixes.length > 0) onApplied();
  }, [onApplied, onReconnectChange]);

  useEffect(() => {
    if (ran.current) return;
    // 向きが決着していなければ今回は見送る（次に開いたときに走る）
    if (getSyncState().kind !== "ready") return;
    ran.current = true;
    void runSync(false);
  }, [runSync]);

  if (pending === 0) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-40 border-b border-accent bg-accent-soft px-5 py-3"
    >
      <div className="phone flex items-start gap-3">
        <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-accent">
          <strong className="block font-medium">
            {pending}件を削除しようとしています。
          </strong>
          数が多いので、いったん止めました。意図した削除か確認してください。
        </span>
        <button
          type="button"
          onClick={() => void runSync(true)}
          className="shrink-0 rounded-md border border-accent-line px-2.5 py-1 text-[11.5px] text-accent"
        >
          確認して削除する
        </button>
        <button
          type="button"
          onClick={() => setPending(0)}
          className="shrink-0 rounded-md border border-accent-line px-2.5 py-1 text-[11.5px] text-accent"
        >
          あとで
        </button>
      </div>
    </div>
  );
}
