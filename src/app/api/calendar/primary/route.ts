import { requireAuthIfEnabled } from "@/lib/require-auth";
import { addDays } from "@/lib/date";
import { listEvents, needsReconnect, refreshAccessToken } from "@/lib/calendar/google";
import { loadLink } from "@/lib/calendar/link";
import { normalizePrimaryEvents } from "@/lib/calendar/primary";
import { toRfc3339 } from "@/lib/calendar/time";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 本人のメインカレンダーの予定を返す。**読み取り専用**。
 *
 * 取り込み（アプリの枠にする）の材料。枠を書くのはブラウザ側で、
 * 判断は calendar/primary.ts の mergePrimary が行う。ここは読んで整えるだけ。
 *
 * 取得期間は専用カレンダーの同期（engine.ts）と同じ -7日〜+60日。
 * 返す from/to は「この期間は全件見た」という約束で、ブラウザはその中だけを
 * 「Googleで消えた」と判断する。**途中までしか読めなかったときは絶対に ok:true を返さない**
 * （見えなかった予定の枠を消してしまう）。
 *
 * 付加機能なので、失敗しても時間割は使える。例外は必ず握って ok:false で返す。
 */
export async function GET() {
  try {
    const denied = await requireAuthIfEnabled();
    if (denied) return denied;

    const link = await loadLink();
    // 未連携は「取り込むものが無い」ではなく「判断できない」。枠を消させない
    if (!link) return Response.json({ ok: false, message: "連携していません。" });

    const token = await refreshAccessToken(link.refreshToken);
    const from = addDays(-7);
    const to = addDays(60);
    const listed = await listEvents(token, "primary", {
      timeMin: toRfc3339(from, "00:00"),
      timeMax: toRfc3339(to, "24:00"),
    });
    if (!listed.ok) {
      return Response.json({ ok: false, message: "予定を取得できませんでした。" });
    }

    return Response.json({
      ok: true,
      from,
      to,
      events: normalizePrimaryEvents(listed.events),
    });
  } catch (err) {
    console.error("[calendar/primary]", err);
    // 権限切れは「連携し直せば直る」。重ね表示と同じ理由で区別して返す
    if (needsReconnect(err)) {
      return Response.json({
        ok: false,
        reason: "reconnect_required",
        message: "カレンダーを読む許可が足りません。設定から連携し直してください。",
      });
    }
    return Response.json({ ok: false, message: "カレンダーを読めませんでした。" });
  }
}
