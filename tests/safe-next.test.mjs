import assert from "node:assert/strict";
import { safeNextPath } from "../src/lib/safe-next.ts";

assert.equal(safeNextPath("/oauth/consent?authorization_id=abc"), "/oauth/consent?authorization_id=abc");
for (const value of [null, "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
  assert.equal(safeNextPath(value), "/", String(value));
}
console.log("Safe login return checks passed");
