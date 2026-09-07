/**
 * カレンダー同期の判断だけを、外部依存なしで切り出したもの。
 *
 * クラウド同期のとき「判断とI/Oを混ぜたせいで組み合わせを全部試せず、
 * 表の一部しか実装していないことに気づけなかった」という失敗をしている。
 * ここは純粋関数にして総当たりできる形にする。
 */

export type CalendarAction =
  /** アプリの枠をカレンダーに作る */
  | "createEvent"
  /** カレンダー側の予定を、アプリの内容で更新する */
  | "updateEvent"
  /** アプリの枠を、カレンダーの内容で更新する（title/start/end のみ） */
  | "updateBox"
  /** カレンダーから予定を消す */
  | "deleteEvent"
  /** アプリから枠を消す */
  | "deleteBox"
  /** カレンダーでは消されたが、書き込みがあるのでアプリには残す */
  | "keepBox"
  /** カレンダーで作られた予定を、アプリに取り込む */
  | "importBox"
  | "none";

export interface CalendarSyncInputs {
  /** アプリ側にこの枠があるか */
  boxExists: boolean;
  /** 習慣から自動で並んでいる仮の枠か（id が "habit-" で始まる） */
  boxIsGhost: boolean;
  /** meta か review に何か書かれているか。消してよいかの判断に使う */
  boxHasNotes: boolean;
  /** TimeBox.updatedAt。古いデータには無いので null を許す */
  boxUpdatedAt: string | null;
  /** カレンダー側の状態。cancelled は「削除された」 */
  eventState: "missing" | "present" | "cancelled";
  /** extendedProperties.private.timeboxId が付いているか（＝うちが作った予定か） */
  eventHasMark: boolean;
  /** Google の event.updated（RFC3339） */
  eventUpdated: string | null;
  /** タイトルと時間が完全に一致しているか */
  contentEqual: boolean;
}

/**
 * 守る不変条件は3つ。
 *
 *   1. 書き込み（メタ認知・振り返り）のある枠を、自動で消さない。
 *      カレンダーは title/start/end しか持たないので、
 *      カレンダーを根拠にそれ以外を失わせてはならない。
 *   2. 印の無い予定を消さない。印が無い ＝ 人がカレンダーで作ったもの。
 *   3. 習慣由来の仮の枠は同期しない（毎回作り直されるため）。
 */
export function decideCalendarAction(i: CalendarSyncInputs): CalendarAction {
  // 3. 習慣由来は何があっても触らない
  if (i.boxIsGhost) return "none";

  if (i.boxExists) {
    if (i.eventState === "missing") return "createEvent";

    if (i.eventState === "cancelled") {
      // 1. 書いたものがあるなら残す。カレンダーの削除だけで失わせない
      return i.boxHasNotes ? "keepBox" : "deleteBox";
    }

    // 両方にある
    if (i.contentEqual) return "none";
    // 同点はアプリ側を優先する（アプリ側の変更は必ず意図的な操作）
    const boxAt = i.boxUpdatedAt ?? "";
    const evAt = i.eventUpdated ?? "";
    return evAt > boxAt ? "updateBox" : "updateEvent";
  }

  // アプリ側に無い
  if (i.eventState !== "present") return "none";
  // 2. 印があればうちが作ったもの＝アプリで消された。無ければ人が作ったもの
  return i.eventHasMark ? "deleteEvent" : "importBox";
}
