import { emptyMeta, type TimeBox } from "@/types/timebox";
import type { GoogleEvent } from "./google";
import { foldEndToSameDay, fromRfc3339 } from "./time";

/**
 * 本人のメインカレンダーの予定を、時間割の枠として取り込む（2026-09-14）。
 *
 * ■ 何ができるようになるか
 *
 * Google で入れた予定に対して、アプリで完了・事前準備・振り返りを付けられる。
 * タイトルと時刻は Google が正で、アプリでは変えない（変えても Google に戻せない
 * ＝読み取り権限しか持っていない。持たないことで本人の予定を壊しようがない）。
 *
 * ■ 専用カレンダーの取り込みと何が違うか
 *
 * 以前は専用カレンダーから取り込んでいて、印の無い予定が二重になる・
 * アプリで消しても復活する、という不具合が本番で出た。原因は
 * 「アプリの枠と予定の対応を、落ちうる googleEventId だけで持っていた」こと。
 * ここでは次の2つで対応が崩れないようにしている。
 *
 *   1. 枠のIDを予定IDから毎回同じ値で作る（primaryBoxId）。
 *      別端末で同時に取り込んでも同じ行に重なるだけで、2件にならない。
 *   2. アプリで消した枠は行を残して hiddenAt を付ける。
 *      「取り込まない」の記録になるので、次の同期で復活しない。
 *
 * ■ ここは I/O を持たない
 *
 * Google から読むのはサーバー（/api/calendar/primary）、枠を書くのはブラウザ
 * （CalendarSyncBoot）。判断はこのファイルの純粋関数に集め、組み合わせを
 * tests/calendar-primary.test.mjs で固定する。
 */

/** 取り込んだ予定1件。アプリの枠にするのに要るぶんだけ */
export interface PrimaryEvent {
  eventId: string;
  /** この予定から作る枠のID（primaryBoxId） */
  boxId: string;
  title: string;
  date: string;
  start: string;
  end: string;
}

/** サーバーが返す取り込みの材料 */
export interface PrimaryFetch {
  /** 取得した期間（両端を含む）。この外の枠は「見えなかった」だけなので消さない */
  from: string;
  to: string;
  events: PrimaryEvent[];
}

/**
 * 一度の同期で消してよい枠の数。超えたら消さずに「Googleで削除済み」に留める。
 *
 * 別の Google アカウントへ繋ぎ直した、Google が一時的に空の一覧を返した、などで
 * 取り込んだ枠が一度に全滅するのを防ぐ。印に留めれば、本人が見て消せる。
 */
export const PRIMARY_DELETE_BRAKE = 5;

/** 取り込まない予定の種類。時間割の枠として意味を持たないもの */
const SKIP_EVENT_TYPES = new Set(["workingLocation", "birthday"]);

// ---------------------------------------------------------------- ID

// tsconfig の target が ES2020 未満なので、BigInt はリテラル（123n）でなく関数で作る
const FNV_PRIME = BigInt("0x100000001b3");
const MASK64 = BigInt("0xffffffffffffffff");
const SEED_HI = BigInt("0xcbf29ce484222325");
const SEED_LO = BigInt("0x84222325cbf29ce4");

/** 64bit の FNV-1a。暗号用ではない（衝突しにくい決まった値が欲しいだけ） */
function fnv1a64(s: string, seed: bigint): bigint {
  let h = seed;
  for (const ch of new TextEncoder().encode(s)) {
    h ^= BigInt(ch);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

/**
 * 予定IDから、枠のIDを決まった値で作る。UUID の形にする。
 *
 * Supabase の主キーは uuid 型なので、形が違うと書き込みごと拒否される（uuid.ts）。
 * ブラウザとサーバーの両方で同期的に同じ値を出したいので、Web Crypto
 * （非同期）ではなく自前の FNV を2本使って128bitにしている。
 */
export function primaryBoxId(eventId: string): string {
  const key = `gcal-primary:${eventId}`;
  const hi = fnv1a64(key, SEED_HI);
  const lo = fnv1a64(key, SEED_LO);
  const hex = (hi.toString(16).padStart(16, "0") + lo.toString(16).padStart(16, "0")).split("");
  // 版を 8（独自形式）、バリアントを RFC 4122 にしておく。判定はゆるいので形だけ整える
  hex[12] = "8";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// ---------------------------------------------------------------- Google の予定を整える

/**
 * Google の予定一覧を、取り込める形に整える。
 *
 * 落とすもの:
 *   - 削除済み（showDeleted で cancelled が来る）
 *   - 終日予定・日をまたぐ予定（時間割の枠は1日の中の時刻で閉じる）
 *   - 自分が出席を断った招待（行かない予定に振り返りは要らない）
 *   - 勤務場所・誕生日など、時間の予約ではない種類
 */
export function normalizePrimaryEvents(events: GoogleEvent[]): PrimaryEvent[] {
  const out: PrimaryEvent[] = [];
  for (const e of events) {
    if (!e.id || e.status === "cancelled") continue;
    if (e.eventType && SKIP_EVENT_TYPES.has(e.eventType)) continue;
    if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
    const s = fromRfc3339(e.start);
    // 23:00〜翌0:00 は 23:00〜24:00 として扱う（engine と同じ約束）
    const en = foldEndToSameDay(s, fromRfc3339(e.end));
    if (!s || !en) continue;
    if (s.date !== en.date || s.time >= en.time) continue;
    out.push({
      eventId: e.id,
      boxId: primaryBoxId(e.id),
      title: e.summary ?? "",
      date: s.date,
      start: s.time,
      end: en.time,
    });
  }
  return out;
}

// ---------------------------------------------------------------- 突き合わせ

/** 事前準備・振り返り・完了のどれかがあるか。あれば Google の削除だけでは消さない */
export function hasNotesOrDone(b: TimeBox): boolean {
  if (b.completedAt) return true;
  if (b.meta.why || b.meta.obstacle || b.meta.counter) return true;
  const r = b.review;
  return Boolean(r && (r.good || r.bad || r.next || r.score != null));
}

export const isFromGoogle = (b: Pick<TimeBox, "source">): boolean => b.source === "google";

/**
 * Google の予定と、アプリの取り込み枠を突き合わせる。
 *
 * `all` には**非表示の枠も含めた全件**を渡すこと。非表示の枠が見えないと
 * 「枠が無い」と判断して、消したはずの予定を取り込み直してしまう。
 *
 * | Google | アプリの枠 | 動作 |
 * |---|---|---|
 * | ある | 無い | 取り込む |
 * | ある | ある | タイトル・日付・時刻を Google の値にそろえる |
 * | ある | 非表示 | 何もしない |
 * | 無い | ある（書き込み・完了なし） | 消す |
 * | 無い | ある（書き込みか完了あり） | 残して sourceGoneAt を付ける |
 * | 無い | 非表示 | 記録ごと片付ける |
 *
 * 「無い」と言えるのは取得した期間の中だけ。期間の外の枠には触らない
 * （期間より前の非表示の記録だけは、もう使わないので片付ける）。
 */
export function mergePrimary(
  all: TimeBox[],
  fetched: PrimaryFetch,
  nowIso: string,
): { upserts: TimeBox[]; deletes: string[]; braked: boolean } {
  const upserts: TimeBox[] = [];
  const hiddenDeletes: string[] = [];
  const goneDeletes: TimeBox[] = [];

  const google = all.filter(isFromGoogle);
  const byEvent = new Map<string, TimeBox>();
  for (const b of google) {
    if (b.sourceEventId) byEvent.set(b.sourceEventId, b);
  }
  const byId = new Map(all.map((b) => [b.id, b]));

  const seen = new Set<string>();
  for (const ev of fetched.events) {
    seen.add(ev.eventId);
    const cur = byEvent.get(ev.eventId) ?? byId.get(ev.boxId);
    if (!cur) {
      upserts.push({
        id: ev.boxId,
        date: ev.date,
        start: ev.start,
        end: ev.end,
        title: ev.title,
        cardId: null,
        color: null,
        habitId: null,
        meta: emptyMeta(),
        completedAt: null,
        review: null,
        source: "google",
        sourceEventId: ev.eventId,
        hiddenAt: null,
        sourceGoneAt: null,
        createdAt: nowIso,
      });
      continue;
    }
    // 同じIDのアプリの枠に出くわした（ありえないはずだが）ら、上書きしない
    if (!isFromGoogle(cur)) continue;
    if (cur.hiddenAt) continue;
    const changed =
      cur.title !== ev.title ||
      cur.date !== ev.date ||
      cur.start !== ev.start ||
      cur.end !== ev.end ||
      Boolean(cur.sourceGoneAt);
    if (!changed) continue;
    // Google が持つのはタイトル・日付・時刻だけ。書き込み・完了・目標・色は残す
    upserts.push({
      ...cur,
      title: ev.title,
      date: ev.date,
      start: ev.start,
      end: ev.end,
      sourceGoneAt: null,
    });
  }

  for (const b of google) {
    if (!b.sourceEventId || seen.has(b.sourceEventId)) continue;
    const inWindow = b.date >= fetched.from && b.date <= fetched.to;
    if (!inWindow) {
      if (b.hiddenAt && b.date < fetched.from) hiddenDeletes.push(b.id);
      continue;
    }
    if (b.hiddenAt) {
      hiddenDeletes.push(b.id);
      continue;
    }
    if (hasNotesOrDone(b)) {
      if (!b.sourceGoneAt) upserts.push({ ...b, sourceGoneAt: nowIso });
      continue;
    }
    goneDeletes.push(b);
  }

  const braked = goneDeletes.length > PRIMARY_DELETE_BRAKE;
  if (braked) {
    for (const b of goneDeletes) {
      if (!b.sourceGoneAt) upserts.push({ ...b, sourceGoneAt: nowIso });
    }
  }

  return {
    upserts,
    deletes: [...hiddenDeletes, ...(braked ? [] : goneDeletes.map((b) => b.id))],
    braked,
  };
}
