/**
 * 本物の予定を、時間割に「重ねて表示する」ためのデータ作り。
 *
 * ■ なぜ取り込まずに重ねるのか
 *
 * アプリを開いても本当の予定が分からないと、空き時間を判断できない。
 * かといってメインカレンダーの予定をアプリの枠として**取り込む**と、
 * それが専用カレンダーへ書き戻されて、Googleカレンダー上に同じ予定が
 * 2つ並ぶ。さらに次の同期では、その予定は専用カレンダーには元々無い
 * IDなので「削除された」と判定される。同期エンジンは1つのカレンダーしか
 * 相手にできない作りなので、混ぜると壊れる。
 *
 * だから重ねるだけにする。アプリ側には一切保存しない。
 * 画面を閉じれば消える、ただの背景である。
 */

/** 重ねて表示する1件。読み取り専用で、アプリのデータにはならない */
export interface OverlayEvent {
  /** 表示用のタイトル。空なら「（タイトルなし）」 */
  title: string;
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:MM" */
  start: string;
  /** "HH:MM" */
  end: string;
  /** どのカレンダーのものか。重なったときに見分ける手がかり */
  calendarName: string;
}

/** Google から返る予定のうち、重ねるのに使う部分だけ */
export interface RawOverlayEvent {
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

export interface BuildOverlayInput {
  events: RawOverlayEvent[];
  calendarName: string;
  /** 表示している日。この日に重なる部分だけを返す */
  date: string;
  /** RFC3339 → {date,time}。engine.ts の実装を渡す */
  parse: (dt: { dateTime?: string; date?: string } | undefined) => {
    date: string;
    time: string;
  } | null;
}

/**
 * 重ねて表示できる形に整える。
 *
 * 落とすもの:
 *   - 削除済み（status: "cancelled"）
 *   - 終日予定（時刻を持たないので時間割の上に置けない）
 *   - アプリが作った予定（印が付いている）。これは既に枠として出ているので、
 *     重ねると同じ予定が二重に見える
 *   - 表示中の日に重ならないもの
 *
 * 日をまたぐ予定は、表示している日の範囲へ切り詰める。
 * 「00:00〜24:00 で埋まっている」と見えるのが正しく、
 * 落としてしまうと空いているように見えて予定を入れてしまう。
 */
export function buildOverlay(i: BuildOverlayInput): OverlayEvent[] {
  const out: OverlayEvent[] = [];

  for (const e of i.events) {
    if (e.status === "cancelled") continue;
    // アプリが作った予定は、既に本体の枠として描かれている
    if (e.extendedProperties?.private?.timeboxId) continue;

    const s = i.parse(e.start);
    const en = i.parse(e.end);
    if (!s || !en) continue; // 終日予定は時刻を持たない

    // 表示中の日にかすりもしないものは捨てる
    if (en.date < i.date || s.date > i.date) continue;
    // 前日から続いていれば 00:00 から、翌日へ続くなら 24:00 まで
    const start = s.date < i.date ? "00:00" : s.time;
    const end = en.date > i.date ? "24:00" : en.time;
    // 日付だけの差で潰れた（前日23:59に終わる等）ものは出さない
    if (start >= end) continue;

    out.push({
      title: e.summary?.trim() || "（タイトルなし）",
      date: i.date,
      start,
      end,
      calendarName: i.calendarName,
    });
  }

  // 早い順。同時刻なら長いほうを先に（背面に置きたいので）
  out.sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  return out;
}
