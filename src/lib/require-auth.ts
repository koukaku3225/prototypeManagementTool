import { supabaseServer } from "@/lib/supabase/server";

/**
 * APIルートの入り口で呼ぶ。
 *
 * ログインは今のところ任意（Stage 1の判断）なので、既定では何もしない
 * ―― ここを常時オンにすると、竜一さんがまだログインしていない状態で
 * このアプリを日常的に使えなくなる。外部に公開するときに
 * REQUIRE_AUTH=true を設定して、初めて効くようにしてある。
 *
 * 認証済みなら null、拒否すべきなら返すべき Response を返す。
 */
export async function requireAuthIfEnabled(): Promise<Response | null> {
  if (process.env.REQUIRE_AUTH !== "true") return null;

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json(
      { error: "unauthorized", message: "ログインが必要です。" },
      { status: 401 },
    );
  }
  return null;
}
