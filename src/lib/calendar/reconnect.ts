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
  /**
   * IDは変わったのに、連携を作り直した形跡が無い（R12）。
   * 何も落とさず目印も書いていない。呼び出し側はこの回の同期を見送ること。
   */
  suspicious: boolean;
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
  /**
   * いまの連携を作った時刻（google_calendar_links.connected_at）。R12。
   * 省略（undefined）すると時刻を見ない、以前の判定になる。
   * null は「時刻が取れなかった」で、IDが変わっていれば不審として扱う。
   */
  currentConnectedAt?: string | null;
  storage: ReconnectStorage<T>;
}): ReconnectOutcome {
  const { currentCalendarId, storage } = i;
  if (!currentCalendarId) return { changed: false, suspicious: false, cleared: 0, failed: 0 };

  const previous = parseCalendarFlag(storage.readFlag());
  const previousCalendarId = previous?.calendarId ?? null;
  let changed = calendarChanged({ previousCalendarId, currentCalendarId });

  /*
   * R12: IDが変わっただけでは「繋ぎ直した」と言い切らない。
   *
   * 全期間の枠からIDを落とすのは取り返しがつかない（落ちた瞬間に目印も新しい値へ移り、
   * 次回は changed=false で自己回復しない）。本物の繋ぎ直しなら、連携を作り直した時刻
   * （connected_at）が必ず前回より新しい。新しくないのにIDだけ違うのは、status が
   * 想定外の値を返したと見て、落とさず・目印も書かず・この回の同期を見送らせる。
   *
   * 前回の目印が古い形（IDだけ）なら比べようがない。その場合は以前どおり繋ぎ直しとして
   * 扱う。ここを不審にすると、修正前から使っている端末で本物の繋ぎ直しが永久に止まる。
   */
  if (changed && i.currentConnectedAt !== undefined && previous?.connectedAt) {
    const now = i.currentConnectedAt ? Date.parse(i.currentConnectedAt) : NaN;
    const before = Date.parse(previous.connectedAt);
    if (!(now > before)) {
      return { changed: false, suspicious: true, cleared: 0, failed: 0 };
    }
  }
  if (changed && i.currentConnectedAt === null && previous && !previous.connectedAt) {
    // 時刻が取れず、前回も時刻を持たない。比べる材料がゼロなので、以前どおり繋ぎ直し扱い
    changed = true;
  } else if (changed && i.currentConnectedAt === null) {
    return { changed: false, suspicious: true, cleared: 0, failed: 0 };
  }

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
  if (failed === 0) {
    storage.writeFlag(
      i.currentConnectedAt
        ? JSON.stringify({ calendarId: currentCalendarId, connectedAt: i.currentConnectedAt })
        : currentCalendarId,
    );
  }
  return { changed, suspicious: false, cleared, failed };
}

/**
 * 目印を読む。新しい形は JSON（カレンダーIDと連携した時刻）、古い形はIDの文字列だけ。
 * JSON として読めないものは古い形とみなす（壊れた値でも落ちない）。
 */
function parseCalendarFlag(
  raw: string | null,
): { calendarId: string; connectedAt: string | null } | null {
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const j = JSON.parse(raw) as { calendarId?: unknown; connectedAt?: unknown };
      if (typeof j.calendarId === "string") {
        return {
          calendarId: j.calendarId,
          connectedAt: typeof j.connectedAt === "string" ? j.connectedAt : null,
        };
      }
    } catch {
      /* 下で古い形として扱う */
    }
  }
  return { calendarId: raw, connectedAt: null };
}

// ------------------------------------------------ 「連携し直してください」の印（R12 ②）

/**
 * 印の値。重ね表示（読み取り）と同期（書き込み）のどちらで権限切れを踏んだか。
 * - "0" / null … 無し
 * - "overlay" … 重ね表示で踏んだ。修正前の "1" もこれとして読む
 * - "sync" … 同期で踏んだ
 * - "both" … 両方
 *
 * 1つの "1" だけで持っていたときは、重ね表示が読めた瞬間に消していた。
 * 同期側の権限切れまで同時に消えると、案内が出てもすぐ消えてしまう。
 */
export type ReconnectSource = "overlay" | "sync" | "both";
export type ReconnectEvent = "overlay_ok" | "overlay_reconnect" | "sync_ok" | "sync_reconnect";

export function reconnectBannerSource(raw: string | null): ReconnectSource | null {
  if (raw === "1" || raw === "overlay") return "overlay";
  if (raw === "sync" || raw === "both") return raw;
  return null;
}

export function nextReconnectFlag(raw: string | null, event: ReconnectEvent): string {
  const cur = reconnectBannerSource(raw);
  let overlay = cur === "overlay" || cur === "both";
  let sync = cur === "sync" || cur === "both";
  if (event === "overlay_ok") overlay = false;
  if (event === "overlay_reconnect") overlay = true;
  if (event === "sync_ok") sync = false;
  if (event === "sync_reconnect") sync = true;
  if (overlay && sync) return "both";
  if (overlay) return "overlay";
  if (sync) return "sync";
  return "0";
}
