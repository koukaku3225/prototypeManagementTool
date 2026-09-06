/**
 * OAuthの往復で使う合言葉（state）を入れるCookieの名前。
 *
 * connect と callback の両方が要るが、ルートファイルから export すると
 * Next.js が検証する export 面を汚すうえ、ルート同士が互いを import する
 * 不健全な依存になる。共有する値はここに置く。
 */
export const STATE_COOKIE = "gc_oauth_state";
