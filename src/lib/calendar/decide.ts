/**
 * 専用カレンダーへの書き込みの判断だけを、外部依存なしで切り出したもの。
 *
 * クラウド同期のとき「判断とI/Oを混ぜたせいで組み合わせを全部試せず、
 * 表の一部しか実装していないことに気づけなかった」という失敗をしている。
 * ここは純粋関数にして総当たりできる形にする。
 *
 * ■ 一方向（アプリ → 専用カレンダー）である理由（2026-09-14）
 *
 * 以前は専用カレンダーで作った予定も取り込んでいた。ところが取り込んだ予定には
 * 印（timeboxId）が無いので、予定IDが一度落ちると対応が見つからず
 * 「作り直し＋もう一度取り込み」で二重になり、アプリで消しても
 * 「カレンダーで新しく作られた」と見なされて復活した（本番で実際に起きた）。
 * 予定を入れる入口は本人のメインカレンダーに一本化し（primary.ts）、
 * 専用カレンダーはアプリの枠を映すだけにした。アプリが常に正。
 */

export type CalendarAction =
  /** アプリの枠をカレンダーに作る */
  | "createEvent"
  /** カレンダー側の予定を、アプリの内容で更新する（印も付け直す） */
  | "updateEvent"
  /** カレンダーから予定を消す */
  | "deleteEvent"
  | "none";

export interface CalendarSyncInputs {
  /** アプリ側にこの枠があるか */
  boxExists: boolean;
  /** 習慣から自動で並んでいる仮の枠か（id が "habit-" で始まる） */
  boxIsGhost: boolean;
  /** カレンダー側の状態。cancelled は「削除された」 */
  eventState: "missing" | "present" | "cancelled";
  /** extendedProperties.private.timeboxId が付いているか（＝うちが作った予定か） */
  eventHasMark: boolean;
  /** タイトルと時間が完全に一致しているか */
  contentEqual: boolean;
}

/**
 * 守る不変条件は3つ。
 *
 *   1. 専用カレンダーを根拠に、アプリの枠を書き換えたり消したりしない。
 *   2. 印の無い予定を消さない。印が無い ＝ 人がカレンダーで作ったもの。
 *   3. 習慣由来の仮の枠は同期しない（毎回作り直されるため）。
 */
export function decideCalendarAction(i: CalendarSyncInputs): CalendarAction {
  if (i.boxIsGhost) return "none";

  if (i.boxExists) {
    // 無い・消された、どちらもアプリが正なので作る
    if (i.eventState !== "present") return "createEvent";
    // 印が無い予定（旧取り込み分）は、中身が同じでも印を付けるために直す
    if (i.contentEqual && i.eventHasMark) return "none";
    return "updateEvent";
  }

  if (i.eventState !== "present") return "none";
  return i.eventHasMark ? "deleteEvent" : "none";
}
