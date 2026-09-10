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
 *
 * ■ 落とす対象は「送るデータ」ではなく localStorage 本体
 *
 * 以前は送信用に組み立てた配列の中だけでIDを落としていた。
 * これだと次の2つの穴が残る（2026-09-08 のレビュー指摘1）。
 *
 *   1. 送信範囲（-14〜+90日）の外にある枠は、そもそも配列に入らないので
 *      古いIDを持ったまま localStorage に残る
 *   2. 作り直しに失敗した枠（Googleのレート制限など）は新しいIDが返らず、
 *      localStorage 側は古いIDのまま残る
 *
 * どちらも「繋ぎ直し済み」の目印だけが新しくなるので、次回以降は
 * 「変わっていない」と判断されて二度と落とされない。残った古いIDが
 * サーバーの処理窓（-7〜+60日）に入った瞬間に「削除された」と誤判定され、
 * **繋ぎ直しの数十日後に、時間割の枠が一言もなく消える**。
 *
 * なので落とす操作は localStorage 本体に対して行い、**落とし終えてから**
 * 目印を書く。目印が意味するのは「この端末の localStorage に、別カレンダーの
 * IDはもう残っていない」であって、送信の成否ではない。
 * 送信が失敗しても、IDが空なら次回は「作り直す」方向にしか倒れない。
 */

/*
 * 端末固有の覚え書き。ユーザーの成果物ではないので同期もバックアップもしない。
 * 定義は storage-keys.ts の DEVICE_KEY に集約してある（resetAll が
 * 消し漏らすと、古い目印だけが生き残って誤判定の元になるため）。
 */
export const LAST_CALENDAR_KEY = DEVICE_KEY.lastCalendarId;

/**
 * 繋ぎ直したと言い切れるか。
 *
 * 落とさないのは次の場合。いずれも「変わっていない」か「判断できない」。
 *   - 現在のカレンダーが分からない（連携していない・状態取得に失敗）
 *   - 前回が分からない（この端末で初めて同期する）
 *     初回に落とす必要は無い。IDが入っているならそれは同じカレンダーの
 *     ものだからで、ここで落とすと毎回作り直して重複させてしまう
 *   - 前回と同じ
 */
export function calendarChanged(i: {
  previousCalendarId: string | null;
  currentCalendarId: string | null;
}): boolean {
  if (!i.currentCalendarId) return false;
  if (i.previousCalendarId === null) return false;
  return i.previousCalendarId !== i.currentCalendarId;
}

/** 枠の読み書きと目印の読み書き。テストから差し替えられるようにしてある */
export interface ReconnectStorage<T extends { googleEventId?: string | null }> {
  /** **全期間の**枠。期間で絞ったものを渡してはいけない */
  loadAll: () => T[];
  /**
   * 1件保存する。**保存できなかったときは false を返すこと。**
   * 戻り値を返さない実装（void）は成功扱いにする。
   */
  save: (box: T) => boolean | void;
  readFlag: () => string | null;
  writeFlag: (value: string) => void;
}

export interface ReconnectOutcome {
  /** 繋ぎ直しを検知したか */
  changed: boolean;
  /** 実際にIDを落とした枠の数。ログ用 */
  cleared: number;
  /** 落とそうとしたが保存に失敗した枠の数。1件でもあれば目印は書かない */
  failed: number;
}

/**
 * 繋ぎ直しを検知して localStorage 上の古い予定IDを落とし、目印を更新する。
 *
 * 呼ぶのは同期の**送信より前**。ここを通ったあとの `loadAll()` は
 * 「現在のカレンダーのIDしか持っていない」状態になっている。
 *
 * 連携状態が分からない（`currentCalendarId` が null）ときは何もしない。
 * 目印も書かない —— 分からないまま上書きすると、次回の判定材料が消える。
 */
export function applyCalendarReconnect<
  T extends { googleEventId?: string | null },
>(i: {
  currentCalendarId: string | null;
  storage: ReconnectStorage<T>;
}): ReconnectOutcome {
  const { currentCalendarId, storage } = i;
  if (!currentCalendarId) return { changed: false, cleared: 0, failed: 0 };

  const previousCalendarId = storage.readFlag();
  const changed = calendarChanged({ previousCalendarId, currentCalendarId });

  let cleared = 0;
  let failed = 0;
  if (changed) {
    for (const b of storage.loadAll()) {
      if (!b.googleEventId) continue;
      // 戻り値を返さない実装（void）は成功扱い。false のときだけ失敗と数える
      if (storage.save({ ...b, googleEventId: null }) === false) failed++;
      else cleared++;
    }
  }

  /*
   * 目印は最後に書く。順序が逆だと、書いた直後に落とす処理が失敗したときに
   * 「片付いた」という嘘だけが残る。
   *
   * 繋ぎ直していないとき（初回を含む）にも書くのは、ここを通らないと
   * 目印が永久に null のままになり、**次に繋ぎ直しても検知できない**ため。
   * 以前は同期の成功後にだけ書いていたので、一度でも同期に失敗した端末は
   * 検知不能なまま放置されていた。
   *
   * ただし**1件でも保存に失敗したら書かない**（2026-09-10 レビュー指摘2）。
   * localStorage が逼迫していると `write()` は false を返すだけで例外を
   * 投げないので、順序を守っていても「一部の枠に古いIDが残ったまま、
   * 目印だけ新しい」状態を作れてしまう。これは目印が二度と `changed` に
   * ならない＝**残った古いIDが処理窓に入った日に、枠が一言もなく消える**
   * という、この関数が塞いだはずの穴そのもの。書かなければ次回やり直せる。
   */
  if (failed === 0) storage.writeFlag(currentCalendarId);
  return { changed, cleared, failed };
}
