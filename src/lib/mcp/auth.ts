import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { getMcpConfig, type McpConfig } from "./config";

export interface McpPrincipal { userId: string; clientId: string }
const requestPrincipals = new WeakMap<Request, McpPrincipal>();

export async function verifyMcpToken(
  token: string,
  options: Pick<McpConfig, "issuer" | "audience" | "clientIds"> & { key: JWTVerifyGetKey },
): Promise<McpPrincipal> {
  const { payload } = await jwtVerify(token, options.key, {
    issuer: options.issuer,
    audience: options.audience,
    algorithms: ["RS256", "ES256"],
  });
  const clientId = typeof payload.client_id === "string" ? payload.client_id : "";
  if (!payload.sub || !Number.isFinite(payload.exp) || !Number.isFinite(payload.iat)) throw new Error("mcp_unauthorized");
  if (!clientId || !options.clientIds.includes(clientId)) throw new Error("mcp_forbidden");
  return { userId: payload.sub, clientId };
}

export async function authenticateMcpRequest(req: Request): Promise<McpPrincipal> {
  const cached = requestPrincipals.get(req);
  if (cached) return cached;
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer ([^\s]+)$/);
  if (!match) throw new Error("mcp_unauthorized");
  const config = getMcpConfig();
  const key = createRemoteJWKSet(new URL(config.jwksUrl));
  const principal = await verifyMcpToken(match[1], { ...config, key });
  requestPrincipals.set(req, principal);
  return principal;
}
