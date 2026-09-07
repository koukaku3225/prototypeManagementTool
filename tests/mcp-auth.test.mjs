import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyMcpToken } from "../src/lib/mcp/auth.ts";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = "test-key";
const issuer = "https://auth.example.test/auth/v1";
const audience = "https://app.example.test/api/mcp";
async function token(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ client_id: "allowed-client", ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer).setAudience(audience).setSubject("user-a")
    .setIssuedAt(now).setExpirationTime(now + 300).sign(privateKey);
}
async function tokenWithoutExpiry() {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ client_id: "allowed-client" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer).setAudience(audience).setSubject("user-a").setIssuedAt(now).sign(privateKey);
}
const key = async () => publicKey;
const valid = await verifyMcpToken(await token(), {
  issuer, audience, clientIds: ["allowed-client"], key,
});
assert.deepEqual(valid, { userId: "user-a", clientId: "allowed-client" });
await assert.rejects(() => token({ client_id: "blocked-client" }).then((value) => verifyMcpToken(value, {
  issuer, audience, clientIds: ["allowed-client"], key,
})));
await assert.rejects(() => token().then((value) => verifyMcpToken(value, {
  issuer, audience: "https://other.example/api/mcp", clientIds: ["allowed-client"], key,
})));
await assert.rejects(() => tokenWithoutExpiry().then((value) => verifyMcpToken(value, {
  issuer, audience, clientIds: ["allowed-client"], key,
})));

console.log("MCP auth checks passed");
