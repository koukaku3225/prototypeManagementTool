import assert from "node:assert/strict";
import { safeOAuthRedirect } from "../src/app/oauth/consent/redirect.ts";

assert.equal(safeOAuthRedirect("https://chat.example/callback?code=abc"), "https://chat.example/callback?code=abc");
assert.equal(safeOAuthRedirect("http://localhost:3000/callback"), "http://localhost:3000/callback");
for (const value of ["javascript:alert(1)", "data:text/html,test", "//example.com", "/callback", "http://example.com", "https://user:password@example.com"]) {
  assert.equal(safeOAuthRedirect(value), null, value);
}
console.log("MCP consent redirect checks passed");
