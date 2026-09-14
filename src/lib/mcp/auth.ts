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

/**
 * 公開鍵の取得口を URL ごとに使い回す。
 *
 * 以前は要求のたびに createRemoteJWKSet() を作っていた。jose の鍵キャッシュ・
 * 同時要求の統合・再取得の間隔はそのインスタンスが持つので、毎回作ると効かず、
 * 形だけ JWT の無効なトークンを送るたびに認証サーバーへ鍵を取りに行っていた
 * （セキュリティレビュー指摘10）。URL はサーバー設定から決まり、利用者は選べない。
 */
const jwksByUrl = new Map<string, JWTVerifyGetKey>();

export function getJwks(url: string): JWTVerifyGetKey {
  let key = jwksByUrl.get(url);
  if (!key) {
    key = createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
    jwksByUrl.set(url, key);
  }
  return key;
}

export async function authenticateMcpRequest(req: Request): Promise<McpPrincipal> {
  const cached = requestPrincipals.get(req);
  if (cached) return cached;
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer ([^\s]+)$/);
  if (!match) throw new Error("mcp_unauthorized");
  const config = getMcpConfig();
  const key = getJwks(config.jwksUrl);
  const principal = await verifyMcpToken(match[1], { ...config, key });
  requestPrincipals.set(req, principal);
  return principal;
}
