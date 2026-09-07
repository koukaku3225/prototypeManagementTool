import { requireAuthIfEnabled } from "@/lib/require-auth";
import { deleteLink } from "@/lib/calendar/link";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST() {
  const denied = await requireAuthIfEnabled();
  if (denied) return denied;
  // カレンダー側の予定は消さない。消すと取り返しがつかない
  // deleteLink は成否を boolean で返す仕様なので、そのまま伝える。
  // ここで無条件に ok: true を返すと、実際は解除できていないのに
  // 画面だけ「解除しました」と嘘をつくことになる。
  const ok = await deleteLink();
  return Response.json({ ok });
}
