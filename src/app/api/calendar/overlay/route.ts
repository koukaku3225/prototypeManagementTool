import { CalendarOverlayQuerySchema } from "@/lib/api-schema";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { fromRfc3339, toRfc3339 } from "@/lib/calendar/engine";
import {
  listCalendars,
  listEvents,
  needsReconnect,
  refreshAccessToken,
} from "@/lib/calendar/google";
import { loadLink } from "@/lib/calendar/link";
import { buildOverlay, type OverlayEvent } from "@/lib/calendar/overlay";

export const runtime = "nodejs";
export const maxDuration = 30;

/** 1回で読むカレンダーの上限。1つにつき1往復するので、際限なく増やせない */
const MAX_CALENDARS = 8;

/**
 * その日の「本物の予定」を返す。**読み取り専用**。
 *
 * 時間割に重ねて出すためだけのもので、アプリのデータにはしない。
 * 取り込む（＝アプリの枠にする）と専用カレンダーへ書き戻されて
 * 予定が二重になり、次の同期で消える。混ぜないことが前提の設計。
 *
 * 付加機能なので、失敗しても時間割そのものは使えなければならない。
 * 例外は必ず握って ok:false で返す（レート制限で同じ穴を踏んでいる）。
 */
export async function GET(req: Request) {
  try {
    const denied = await requireAuthIfEnabled();
    if (denied) return denied;

    /*
     * 日付以外の文字列でGoogleを叩かせない。
     * AGENTS.md の「APIルートの入力は必ず api-schema.ts の zod を通す」に
     * 揃えてある（以前はここだけ正規表現をインラインで持っていた）。
     */
    const q = CalendarOverlayQuerySchema.safeParse({
      date: new URL(req.url).searchParams.get("date") ?? "",
    });
    if (!q.success) {
      return Response.json({ ok: false, message: "日付の指定が不正です。" });
    }
    const { date } = q.data;

    const link = await loadLink();
    if (!link) return Response.json({ ok: true, events: [] }); // 未連携は空で正常

    const token = await refreshAccessToken(link.refreshToken);

    /*
     * 本人が Google カレンダー側で非表示にしているものは重ねない。
     * 向こうで消しているのにこちらで出るのは、本人の意思に反する。
     * 専用カレンダーも除く（その予定は既に本体の枠として描かれている）。
     */
    const calendars = (await listCalendars(token))
      .filter((c) => c.selected && c.id !== link.calendarId)
      /*
       * 数を切る。カレンダーごとに1往復するので、多いと
       * maxDuration を超えて全部出なくなる。少しでも出るほうがよい。
       * 購読カレンダー（祝日・スポーツ等）を大量に持つ人がいる。
       */
      .slice(0, MAX_CALENDARS);

    const timeMin = toRfc3339(date, "00:00");
    const timeMax = toRfc3339(date, "24:00");

    /*
     * まとめて投げる。直列だとカレンダーの数だけ待ち時間が積み上がり、
     * 5個で数秒かかって画面が「後から急に埋まる」ことになる。
     * 1つ読めなくても他は出す（allSettled）。
     */
    const results = await Promise.allSettled(
      calendars.map(async (cal) => {
        const listed = await listEvents(token, cal.id, { timeMin, timeMax });
        if (!listed.ok) return [];
        return buildOverlay({
          events: listed.events,
          calendarName: cal.summary,
          date,
          parse: fromRfc3339,
        });
      }),
    );

    const events: OverlayEvent[] = [];
    for (const [i, r] of results.entries()) {
      if (r.status === "fulfilled") events.push(...r.value);
      else console.warn("[calendar/overlay] skip", calendars[i]?.id, r.reason);
    }

    events.sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
    return Response.json({ ok: true, events });
  } catch (err) {
    console.error("[calendar/overlay]", err);
    /*
     * 401/403 は「連携し直せば直る」失敗なので、他の失敗と必ず区別する。
     *
     * 読み取りスコープ（calendar.readonly）を後から足しても、OAuthで
     * 許可された権限は同意時点の refresh_token に固定されている。
     * 既に連携済みの人には遡って付かないので、Googleは403を返し続ける。
     * これを「読めませんでした」に丸めて握りつぶしていたため、
     * **重ね表示が永久に0件のまま、理由がどこにも出なかった**
     * （2026-09-08 指摘2）。本人が再連携するまで直らない以上、
     * 「再連携が要る」ことは画面まで届けなければならない。
     */
    if (needsReconnect(err)) {
      return Response.json({
        ok: false,
        reason: "reconnect_required",
        message:
          "カレンダーを読む許可が足りません。設定から連携し直してください。",
      });
    }
    return Response.json({
      ok: false,
      message: "カレンダーを読めませんでした。",
    });
  }
}
