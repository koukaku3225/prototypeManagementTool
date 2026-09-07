import { supabaseServer } from "@/lib/supabase/server";
import { authenticateMcpRequest } from "@/lib/mcp/auth";
import { getMcpConfig } from "@/lib/mcp/config";

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
export async function requireAuthIfEnabled(options?: { mcpRequest?: Request }): Promise<Response | null> {
  if (options?.mcpRequest) {
    try {
      await authenticateMcpRequest(options.mcpRequest);
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "mcp_unauthorized";
      const unavailable = message === "mcp_disabled" || message === "mcp_misconfigured";
      const forbidden = message === "mcp_forbidden";
      let authenticate = "Bearer";
      try {
        const resource = new URL(getMcpConfig().resourceUrl);
        const metadata = new URL(`/.well-known/oauth-protected-resource${resource.pathname}`, resource);
        authenticate += ` resource_metadata=\"${metadata.href}\"`;
      } catch { /* 設定不備では認証メタデータも公開できない */ }
      return Response.json(
        { error: unavailable ? "mcp_unavailable" : forbidden ? "forbidden" : "unauthorized" },
        { status: unavailable ? 503 : forbidden ? 403 : 401, headers: unavailable || forbidden ? undefined : { "WWW-Authenticate": authenticate } },
      );
    }
  }
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
