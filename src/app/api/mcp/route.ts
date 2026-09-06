import { createClient } from "@supabase/supabase-js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { authenticateMcpRequest } from "@/lib/mcp/auth";
import { getMcpConfig } from "@/lib/mcp/config";
import { createMcpRepository } from "@/lib/mcp/repository";
import { createGoalCoachMcpServer } from "@/lib/mcp/server";
import { McpEnvelopeSchema, MAX_BODY_BYTES } from "@/lib/api-schema";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

async function handle(req: Request): Promise<Response> {
  const denied = await requireAuthIfEnabled({ mcpRequest: req });
  if (denied) return denied;
  const principal = await authenticateMcpRequest(req);
  const limited = await checkRateLimit(`mcp:${principal.userId}`, "mcp");
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
  let parsedBody: unknown;
  if (req.method === "POST") {
    const raw = await req.clone().text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return Response.json({ error: "body_too_large" }, { status: 413 });
    try { parsedBody = McpEnvelopeSchema.parse(JSON.parse(raw)); }
    catch { return Response.json({ error: "invalid_mcp_request" }, { status: 400 }); }
  }
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
