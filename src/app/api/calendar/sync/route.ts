import { CalendarSyncRequestSchema, parseBody } from "@/lib/api-schema";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { runSync } from "@/lib/calendar/engine";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = await requireAuthIfEnabled();
  if (denied) return denied;

  const parsed = await parseBody(req, CalendarSyncRequestSchema);
  if (!parsed.ok) {
    return Response.json(
      { ok: false, message: "不正な入力です。" },
      { status: parsed.status },
    );
  }

  try {
    const r = await runSync(parsed.data.boxes, parsed.data.confirmDeletes ?? false);
    return Response.json(r.ok ? { ok: true, ...r.result } : r);
  } catch (err) {
    /*
     * カレンダー同期は付加機能であって、時間割そのものではない。
     * 例外を投げっぱなしにすると500になり、呼び出し側の画面まで巻き込む。
     * レート制限で同じ穴を踏んだので、必ず ok:false で返す。
     */
    console.error("[calendar/sync]", err);
    return Response.json({
      ok: false,
      message: "同期できませんでした。時間をおいて試してください。",
    });
  }
}
