import { addDays } from "@/lib/date";

/**
 * Google の日時とアプリの「日付＋時刻」の変換。
 *
 * engine.ts から切り出した。engine.ts はサーバー専用の依存（Supabase の
 * サーバークライアント）を読むので、ブラウザでも使う取り込み（primary.ts）から
 * 直接 import できないため。engine.ts は互換のためにここを再輸出している。
 */

/**
 * "2026-09-05" + "10:00" → RFC3339（JST固定）
 *
 * このアプリでは `end: "24:00"` が正規の値である（`toTime(1440)` が作り、
 * 一日の最後のマス 23:30–24:00 を押せば普通にできる）。
 * ところが RFC3339 は `time-hour = 2DIGIT ; 00-23` で、**24時を表現できない**。
 * そのまま送ると Google に弾かれるか、翌日0時へ正規化されて
 * 「終わりの日付が翌日」になり、内容一致の判定が永久に成立しなくなる。
 * 同期のたびに枠が書き換わり、最後は 23:30〜00:00 という
 * 長さ0分の枠に潰れていた。
 *
 * こちらで明示的に「翌日の 00:00」へ直しておく。
 */
export function toRfc3339(date: string, time: string): string {
  if (time === "24:00") return `${addDays(1, new Date(`${date}T00:00:00`))}T00:00:00+09:00`;
  return `${date}T${time}:00+09:00`;
}

/**
 * RFC3339 → ローカル表現。終日予定（date のみ）は対象外なので null。
 *
 * `new Date(...).getHours()` はサーバーのタイムゾーンを見る。
 * ローカル開発機は JST だから気づけないが、Vercel の既定タイムゾーンは UTC
 * なので、本番でだけ時刻が9時間ずれる（レビューで実際に指摘された）。
 * `Intl.DateTimeFormat` に `timeZone: "Asia/Tokyo"` を明示することで、
 * 実行環境のタイムゾーンに関係なく常にJSTの時刻を取り出す。
 */
const JST_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function fromRfc3339(
  dt: { dateTime?: string; date?: string } | undefined,
): { date: string; time: string } | null {
  if (!dt?.dateTime) return null;
  const d = new Date(dt.dateTime);
  if (Number.isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(
    JST_FORMAT.formatToParts(d).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  // 環境によって深夜0時が "24" で返ることがあるので丸める
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
  };
}

/**
 * 終わりが「翌日の 00:00」なら、開始と同じ日の "24:00" に畳み直す。
 *
 * toRfc3339 が 24:00 を翌日0時として送るので、読み戻すと日付が翌日になる。
 * そのままだと「終わりの日付が開始と違う」ため内容一致の判定が永久に
 * 成立せず、同期のたびに枠が書き換わって最後は長さ0分に潰れていた。
 * 送るときと読むときで同じ約束にしておく。
 *
 * 本当に日をまたぐ予定（22:00〜翌02:00 など）はここでは畳まない。
 * このアプリの枠は1日で閉じる決まりなので、扱えないものは扱えないまま返す。
 */
export function foldEndToSameDay(
  start: { date: string; time: string } | null,
  end: { date: string; time: string } | null,
): { date: string; time: string } | null {
  if (!start || !end) return end;
  if (end.time !== "00:00") return end;
  const nextOfStart = addDays(1, new Date(`${start.date}T00:00:00`));
  if (end.date !== nextOfStart) return end;
  return { date: start.date, time: "24:00" };
}
