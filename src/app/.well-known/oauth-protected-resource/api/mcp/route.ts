import { getMcpConfig } from "@/lib/mcp/config";

export const maxDuration = 10;

export async function GET() {
  try {
    const config = getMcpConfig();
    return Response.json({
      resource: config.resourceUrl,
      authorization_servers: [config.issuer],
      bearer_methods_supported: ["header"],
      resource_documentation: `${new URL(config.resourceUrl).origin}/settings/connections`,
    }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return Response.json({ error: "mcp_unavailable" }, { status: 503 });
  }
}
