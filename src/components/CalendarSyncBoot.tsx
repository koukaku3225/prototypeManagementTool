"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { addDays } from "@/lib/date";
import { deleteTimeBox, loadTimeBoxes, upsertTimeBox } from "@/lib/storage";
import { getSyncState } from "@/lib/supabase/sync";
import { emptyMeta } from "@/types/timebox";

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
export function CalendarSyncBoot({ onApplied }: { onApplied: () => void }) {
  const ran = useRef(false);
  const [pending, setPending] = useState(0);

  const runSync = useCallback(async (confirmDeletes: boolean) => {
    const from = addDays(SEND_FROM_DAYS);
    const to = addDays(SEND_TO_DAYS);
    const boxes = loadTimeBoxes()
      // 全件送るとAPIスキーマの上限（500件）を超えて弾かれ、以後同期が
      // 恒久的に止まる（レビューで指摘）。期間で絞って送信する
      .filter((b) => b.date >= from && b.date <= to)
      .map((b) => ({
        id: b.id,
        date: b.date,
        start: b.start,
        end: b.end,
        title: b.title,
        googleEventId: b.googleEventId ?? null,
        updatedAt: b.updatedAt,
        hasNotes: Boolean(
          b.meta.why || b.meta.obstacle || b.meta.counter || b.review,
        ),
      }));

    const res = await fetch("/api/calendar/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boxes, confirmDeletes }),
    }).catch(() => null);
    // 通信できなくても時間割は普通に使える
    if (!res) return;
    const data = await res.json().catch(() => null);
    if (!data?.ok) return;

    if (data.pendingDeletes > 0) {
      setPending(data.pendingDeletes);
      return;
    }
    setPending(0);

    // カレンダーは title/start/end/googleEventId しか持たない。
    // meta・review・cardId・color はサーバーから来ないので、元の枠を
    // 展開したうえで返ってきたキーだけを上書きする（本人の記入を守る）
    const all = loadTimeBoxes();
    for (const u of data.upserts ?? []) {
      const cur = all.find((b) => b.id === u.id);
      if (!cur) continue;
      upsertTimeBox({
        ...cur,
        ...(u.title !== undefined ? { title: u.title } : {}),
        ...(u.date !== undefined ? { date: u.date } : {}),
        ...(u.start !== undefined ? { start: u.start } : {}),
        ...(u.end !== undefined ? { end: u.end } : {}),
        ...(u.googleEventId !== undefined ? { googleEventId: u.googleEventId } : {}),
      });
    }
    for (const im of data.imports ?? []) {
      upsertTimeBox({
        id: crypto.randomUUID(),
        date: im.date,
        start: im.start,
        end: im.end,
        title: im.title,
        cardId: null,
        googleEventId: im.googleEventId,
        meta: emptyMeta(),
        completedAt: null,
        review: null,
        createdAt: new Date().toISOString(),
      });
    }
    for (const id of data.deletes ?? []) deleteTimeBox(id);

    const changed =
      (data.upserts?.length ?? 0) +
      (data.imports?.length ?? 0) +
      (data.deletes?.length ?? 0);
    if (changed > 0) onApplied();
  }, [onApplied]);

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
