/**
 * ID が UUID の形をしているか。
 *
 * Supabase 側の主キーは `uuid` 型なので、そうでない文字列を送ると
 * Postgres が `22P02 invalid input syntax for type uuid` で**その回の
 * 書き込みをまるごと拒否**する。1件でも混ざれば、同じ配列で送っている
 * 他の予定も道連れになる。
 *
 * 実際に混入しうるのは、スキーマ移行 v2 が旧「次の一歩」から作る
 * `from-task-<元のid>` という形の ID（storage.ts）。
 * 本人の操作は成功して見えるので、別端末で開くまで気づけない。
 */

/**
 * 版（4bit）とバリアントを問わない、ゆるい判定。
 *
 * 厳密に v4 だけを通すと、他所（Supabase の gen_random_uuid など）が
 * 作った正当な UUID を弾いてしまう。ここで防ぎたいのは
 * 「Postgres の uuid 型に入らない文字列」なので、その一致で十分。
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(id: unknown): boolean {
  return typeof id === "string" && UUID_RE.test(id);
}
