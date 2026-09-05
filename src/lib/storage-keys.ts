/**
 * localStorage のキー定義と、「中身があるか」の判定。
 *
 * storage.ts は "use client" なので、サーバー側（/api/local-backup）から読めない。
 * 同じ判定をサーバーとクライアントの両方で使いたいので、ここだけ分けてある。
 * storage.ts は KEY をここから再輸出しているので、呼び出し側は今までどおり
 * `@/lib/storage` から import してよい。
 */

export const KEY = {
  session: "gc.session",
  card: "gc.card",           // レガシー。移行元としてのみ読む
  cards: "gc.cards",
  bigstory: "gc.bigstory",
  stories: "gc.stories",     // レガシー。SmallStory 廃止で不要。移行で捨てる
  profile: "gc.profile",
  variant: "gc.variant",
  archive: "gc.sessions",
  habits: "gc.habits",
  habitLogs: "gc.habitlogs",
  timeboxes: "gc.timeboxes",
  running: "gc.running",
  schemaVersion: "gc.schemaVersion",
} as const;

/**
 * その端末だけの都合で、ユーザーの成果物ではないキー。
 *
 * 「まだ何も無い状態か」を判断するときに、これらを数えてはいけない。
 * schemaVersion は必ず "3" のような数字が、variant は必ず "\"a\"" のような
 * 文字列が入っていて、どちらも空にならない。これを中身として数えていたため、
 * 「まっさらなブラウザ」を永遠に「中身あり」と誤判定していた
 * （復元の申し出が出ない・空の状態が最新バックアップとして書かれる、
 * という2つの不具合の実際の原因）。
 */
export const DEVICE_LOCAL_KEYS: readonly string[] = [
  KEY.schemaVersion,
  KEY.variant,
  KEY.running,
];

/**
 * 端末固有の覚え書き。KEY とは別にしてあるのは、同期にもスナップショットにも
 * 乗せないため（ユーザーの成果物ではない）。
 *
 * ただし resetAll()（すべて消してやり直す）では消す必要がある。
 * 消し忘れると「この端末は突き合わせ済み」という印だけが生き残り、
 * 空になったローカルを根拠にクラウドを消しにいく。
 */
export const DEVICE_KEY = {
  /** どのユーザーとして一度クラウドと突き合わせたか */
  syncedUser: "gc.syncedUser",
} as const;

/**
 * ユーザーの成果物が1つでも入っているか。
 *
 * 値は localStorage の生の文字列（JSON）。空配列・空オブジェクト・空文字は
 * 「無い」とみなす。端末固有のキーは最初から見ない。
 */
export function hasUserContent(snap: Record<string, string | undefined>): boolean {
  return Object.entries(snap).some(([k, v]) => {
    if (DEVICE_LOCAL_KEYS.includes(k)) return false;
    if (!v) return false;
    const t = v.trim();
    return t !== "[]" && t !== "{}" && t !== "null" && t !== '""';
  });
}
