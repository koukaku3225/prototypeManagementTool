import { requireAuthIfEnabled } from "@/lib/require-auth";
import { loadLink } from "@/lib/calendar/link";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET() {
  const denied = await requireAuthIfEnabled();
  if (denied) return denied;
  try {
    const link = await loadLink();
    // refresh_token は絶対に返さない
    return Response.json({
      connected: Boolean(link),
      lastSyncedAt: link?.lastSyncedAt ?? null,
      lastError: link?.lastError ?? null,
      /*
       * どのカレンダーに繋いでいるか。
       * ブラウザ側が「前回と違う＝繋ぎ直した」を判定して、古い予定IDを
       * 落とすために使う（落とさないと、新しいカレンダーにIDが無いことを
       * 「削除された」と誤判定して時間割が消える）。
       * カレンダーIDは本人のメールアドレスであることが多いが、
       * これは本人にしか返らない（requireAuthIfEnabled + RLS）。
       */
      calendarId: link?.calendarId ?? null,
    });
  } catch (err) {
    /*
     * loadLink はクエリ失敗時に例外を投げる（未連携との区別のため）。
     * ここで捕まえないと通信障害のたびに500になり、設定画面が壊れる。
     * 「連携しているかどうか分からない」ことが伝わればよい。
     */
    console.error("[calendar/status]", err);
    return Response.json({
      connected: false,
      lastSyncedAt: null,
      lastError: "連携状態を確認できませんでした",
      // 分からないときは null。ブラウザ側はこれを見て「触らない」を選ぶ
      calendarId: null,
      unknown: true,
    });
  }
}
