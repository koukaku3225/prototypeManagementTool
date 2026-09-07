export interface McpConfig {
  resourceUrl: string;
  issuer: string;
  audience: string;
  clientIds: string[];
  supabaseUrl: string;
  supabaseKey: string;
  cursorSecret: string;
  jwksUrl: string;
}

export function getMcpConfig(): McpConfig {
  if (process.env.MCP_ENABLED !== "true") throw new Error("mcp_disabled");
  const resourceUrl = process.env.MCP_RESOURCE_URL;
  const issuer = process.env.MCP_ISSUER;
  const audience = process.env.MCP_AUDIENCE ?? resourceUrl;
  const clientIds = (process.env.MCP_ALLOWED_CLIENT_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const cursorSecret = process.env.MCP_CURSOR_SECRET;
  if (!resourceUrl || !issuer || !audience || clientIds.length === 0 || !supabaseUrl || !supabaseKey ||
      !cursorSecret || cursorSecret.length < 32) throw new Error("mcp_misconfigured");
  for (const value of [resourceUrl, issuer, audience]) new URL(value);
  const jwksUrl = process.env.MCP_JWKS_URL ?? `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
  return { resourceUrl, issuer, audience, clientIds, supabaseUrl, supabaseKey, cursorSecret, jwksUrl };
}
