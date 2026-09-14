import { createClient } from "@supabase/supabase-js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { authenticateMcpRequest } from "@/lib/mcp/auth";
import { getMcpConfig } from "@/lib/mcp/config";
import { createMcpRepository } from "@/lib/mcp/repository";
import { createGoalCoachMcpServer } from "@/lib/mcp/server";
import { McpEnvelopeSchema, MAX_BODY_BYTES } from "@/lib/api-schema";
import { checkRateLimit, getIpId } from "@/lib/rate-limit";
import { readBodyLimited } from "@/lib/request-guard";

export const runtime = "nodejs";
export const maxDuration = 30;

async function handle(req: Request): Promise<Response> {
  /*
   * 認証より前に、入口で緩く数える（セキュリティレビュー指摘10）。
   * 認証の検証そのものが外部（公開鍵の取得）と実行時間を使うので、
   * 認証後の制限だけでは、無効なトークンの連打を止められない。
   */
  const entryLimited = await checkRateLimit(`mcp-entry:${getIpId(req)}`, "mcp-entry");
  if (entryLimited) return entryLimited;

  const denied = await requireAuthIfEnabled({ mcpRequest: req });
  if (denied) return denied;
  const principal = await authenticateMcpRequest(req);

  let parsedBody: unknown;
  let cost = 1;
  if (req.method === "POST") {
    const body = await readBodyLimited(req.clone(), MAX_BODY_BYTES);
    if (!body.ok) {
      return body.status === 413
        ? Response.json({ error: "body_too_large" }, { status: 413 })
        : Response.json({ error: "invalid_mcp_request" }, { status: 400 });
    }
    try { parsedBody = McpEnvelopeSchema.parse(JSON.parse(body.text)); }
    catch { return Response.json({ error: "invalid_mcp_request" }, { status: 400 }); }
    // バッチは件数ぶん数える。1要求＝1回だと、20件のバッチで上限の20倍を実行できた（指摘11）
    if (Array.isArray(parsedBody)) cost = parsedBody.length;
  }

  const limited = await checkRateLimit(`mcp:${principal.userId}`, "mcp", cost);
  if (limited) return limited;
  const config = getMcpConfig();
  const token = req.headers.get("authorization")!.slice("Bearer ".length);
  const db = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const repository = createMcpRepository(db, principal.userId, req.signal, config.cursorSecret);
  const server = createGoalCoachMcpServer(repository);
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(req, {
    parsedBody,
    authInfo: { token, clientId: principal.clientId, scopes: [], resource: new URL(config.resourceUrl), extra: { userId: principal.userId } },
  });
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function POST(req: Request) { return handle(req); }
export async function GET(req: Request) { return handle(req); }
export async function DELETE(req: Request) { return handle(req); }
