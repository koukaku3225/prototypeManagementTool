/**
 * OAuthの往復で使う合言葉（state）を入れるCookieの名前。
 *
 * connect と callback の両方が要るが、ルートファイルから export すると
 * Next.js が検証する export 面を汚すうえ、ルート同士が互いを import する
 * 不健全な依存になる。共有する値はここに置く。
 */
export const STATE_COOKIE = "gc_oauth_state";

/**
 * Cookie に入れる値。合言葉に「連携を始めたアプリ利用者」を結び付ける。
 *
 * 以前は合言葉だけを入れていたので、A が連携を始めて Google の同意画面を
 * 開いたままログアウトし、B でログインしてから戻ると、A が選んだ Google の
 * 権限が B の行に保存されえた（セキュリティレビュー指摘13）。
 * Cookie は httpOnly でサーバーだけが書くので、利用者IDを並べて入れれば足りる。
 */
export function encodeStateCookie(state: string, userId: string | null): string {
  return `${state}.${userId ?? ""}`;
}

/**
 * callback で受け取った state と、いまログインしている利用者が、
 * 開始時の Cookie と一致するか。
 */
export function stateMatches(
  cookieValue: string | undefined,
  state: string | null,
  currentUserId: string | null,
): boolean {
  if (!cookieValue || !state) return false;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0) return false;
  const expectedState = cookieValue.slice(0, dot);
  const startedBy = cookieValue.slice(dot + 1);
  if (expectedState !== state) return false;
  // 開始時も戻ったときもログインしていなければ、保存（saveLink）で弾かれる
  return startedBy === (currentUserId ?? "");
}
