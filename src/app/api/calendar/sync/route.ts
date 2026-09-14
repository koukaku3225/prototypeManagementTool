import { CalendarSyncRequestSchema, parseBody } from "@/lib/api-schema";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { runSync } from "@/lib/calendar/engine";
import { checkRateLimit, getCallerId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 同じ人の同期を同時に走らせない（セキュリティレビュー指摘12）。
 * 並べて投げると、同じ枠を二重に作ったり、API 呼び出しが件数×並列数に増える。
 * インスタンスごとのメモリなので厳密ではないが、連打による増幅は止まる。
 */
const inFlight = new Set<string>();

export async function POST(req: Request) {
  let caller: string | null = null;
  try {
    // cookies() 由来の例外は try の外だと素通りして500になる。
    // このルートは失敗時も ok:false で返す方針なので、認証チェックも中に入れる
    const denied = await requireAuthIfEnabled();
    if (denied) return denied;

    const parsed = await parseBody(req, CalendarSyncRequestSchema);
    if (!parsed.ok) {
      return Response.json(
        { ok: false, message: "不正な入力です。" },
        { status: parsed.status },
      );
    }

    const id = await getCallerId(req);
    const limited = await checkRateLimit(id, "calendar");
    if (limited) return limited;
    if (inFlight.has(id)) {
      return Response.json(
        { ok: false, message: "同期中です。少し待ってから試してください。" },
        { status: 409 },
      );
    }
    inFlight.add(id);
    caller = id;

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
  } finally {
    if (caller) inFlight.delete(caller);
  }
}
