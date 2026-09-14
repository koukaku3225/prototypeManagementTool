/**
 * 時間割の枠から、`/api/calendar/sync` に送る本文の枠を作る。
 *
 * 画面（CalendarSyncBoot）の中に書いていたのを切り出した。画面の中にあると、
 * API の入力スキーマ（api-schema.ts の CalendarSyncRequestSchema）と食い違っても
 * どのテストにも引っかからない。実際に 2026-09-14 の一方向化で hasNotes を外したのに
 * スキーマは必須のままで、**専用カレンダーへの同期が本番で毎回 400 になっていた**。
 * tests/calendar-payload.test.mjs が、ここで作った本文をそのままスキーマに通す。
 */
import type { TimeBox } from "@/types/timebox";
import type { SyncBoxInput } from "./engine";
import { isFromGoogle } from "./primary";

export function buildSyncBoxes(all: readonly TimeBox[], from: string, to: string): SyncBoxInput[] {
  return (
    all
      // 画面からは loadTimeBoxes()（非表示を除いたもの）が渡るが、ここでも除いておく
      .filter((b) => !b.hiddenAt)
      // 全件送るとAPIスキーマの上限（500件）を超えて弾かれ、以後同期が
      // 恒久的に止まる（レビューで指摘）。期間で絞って送信する
      .filter((b) => b.date >= from && b.date <= to)
      // メインカレンダーから取り込んだ枠は送らない。送ると専用カレンダーに
      // 同じ予定が写り、Google 上で二重に並ぶ
      .filter((b) => !isFromGoogle(b))
      // 一方向なので、書き込み・目標・更新時刻は送らない（サーバーは使わない）
      .map((b) => ({
        id: b.id,
        date: b.date,
        start: b.start,
        end: b.end,
        title: b.title,
        googleEventId: b.googleEventId ?? null,
      }))
  );
}
