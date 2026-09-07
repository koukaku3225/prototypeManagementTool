import { DEVICE_KEY } from "@/lib/storage-keys";

/**
 * 別のカレンダーへ繋ぎ直したことを検知して、古い予定IDを捨てる。
 *
 * ■ なぜ要るか
 *
 * 同期エンジンは「送った googleEventId が、取得結果に一件も無い」ことを
 * 「カレンダー側で削除された」証拠として使う（engine.ts の eventStateOf）。
 * 全件取得しているので、同じカレンダーを見ている限りこれは正しい。
 *
 * ところが**別のカレンダーへ再連携すると総崩れになる**。新しいカレンダーには
 * どのIDも存在しないので、全部の枠が「削除された」と判定される。
 * 実装上は5件までが無言で消え、それ以上は本人に削除を確認させる形になり、
 * どちらにしても時間割が失われる。
 *
 * エンジン側では区別がつかない（IDがどのカレンダーのものか知らない）。
 * カレンダーが変わったことを知っているのは、状態を持てるこちら側だけなので、
 * ここで古いIDを落としてから送る。落とせば「まだ無い」＝作り直す、になる。
 */

/*
 * 端末固有の覚え書き。ユーザーの成果物ではないので同期もバックアップもしない。
 * 定義は storage-keys.ts の DEVICE_KEY に集約してある（resetAll が
 * 消し漏らすと、古い目印だけが生き残って誤判定の元になるため）。
 */
export const LAST_CALENDAR_KEY = DEVICE_KEY.lastCalendarId;

export interface ReconnectInput<T> {
  boxes: T[];
  /** 前回この端末が同期したカレンダー。初回は null */
  previousCalendarId: string | null;
  /** いま連携しているカレンダー。連携状態を取れなければ null */
  currentCalendarId: string | null;
}

export interface ReconnectResult<T> {
  boxes: T[];
  /** 実際に落としたか。呼び出し側が覚え書きの更新とログに使う */
  cleared: boolean;
}

/**
 * カレンダーが変わっていれば、全ての枠から googleEventId を落とす。
 *
 * 落とさないのは次の場合。いずれも「変わっていない」か「判断できない」。
 *   - 現在のカレンダーが分からない（連携していない・状態取得に失敗）
 *   - 前回が分からない（この端末で初めて同期する）
 *     初回に落とす必要は無い。IDが入っているならそれは同じカレンダーの
 *     ものだからで、ここで落とすと毎回作り直して重複させてしまう
 *   - 前回と同じ
 */
export function clearEventIdsIfCalendarChanged<
  T extends { googleEventId?: string | null },
>(i: ReconnectInput<T>): ReconnectResult<T> {
  const { boxes, previousCalendarId, currentCalendarId } = i;
  if (!currentCalendarId) return { boxes, cleared: false };
  if (previousCalendarId === null) return { boxes, cleared: false };
  if (previousCalendarId === currentCalendarId) return { boxes, cleared: false };

  return {
    boxes: boxes.map((b) =>
      b.googleEventId ? { ...b, googleEventId: null } : b,
    ),
    cleared: true,
  };
}
