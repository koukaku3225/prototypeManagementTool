import assert from "node:assert/strict";
import { McpEnvelopeSchema, McpWeeklyInputSchema } from "../src/lib/api-schema.ts";
import {
  encodeMcpCursor,
  decodeMcpCursor,
  trimMcpText,
  weekEndExclusive,
} from "../src/lib/mcp/data.ts";

assert.equal(McpWeeklyInputSchema.safeParse({ week_start: "2026-09-01" }).success, true);
for (const week_start of ["2026-02-30", "2026-9-1", "", "2026-09-01T00:00:00Z"]) {
  assert.equal(McpWeeklyInputSchema.safeParse({ week_start }).success, false, week_start);
}
assert.equal(weekEndExclusive("2026-12-28"), "2027-01-04");
assert.equal(McpEnvelopeSchema.safeParse([{ jsonrpc: "2.0", id: 1, method: "initialize" }]).success, true);
assert.equal(McpEnvelopeSchema.safeParse(Array.from({ length: 21 }, () => ({ jsonrpc: "2.0", method: "ping" }))).success, false);
assert.deepEqual(trimMcpText("abc", 3), { value: "abc", truncated: false });
assert.deepEqual(trimMcpText("abcd", 3), { value: "abc", truncated: true });

const cursor = encodeMcpCursor(
  { userId: "user-a", tool: "weekly", argsHash: "hash-a", habitOffset: 4, timeboxOffset: 8 },
  "secret-that-is-long-enough",
  1_000,
);
assert.equal(
  decodeMcpCursor(cursor, "secret-that-is-long-enough", {
    userId: "user-a",
    tool: "weekly",
    argsHash: "hash-a",
    nowSeconds: 1_100,
  }).habitOffset,
  4,
);
for (const check of [
  { userId: "user-b", tool: "weekly", argsHash: "hash-a", nowSeconds: 1_100 },
  { userId: "user-a", tool: "goals", argsHash: "hash-a", nowSeconds: 1_100 },
  { userId: "user-a", tool: "weekly", argsHash: "hash-b", nowSeconds: 1_100 },
  { userId: "user-a", tool: "weekly", argsHash: "hash-a", nowSeconds: 5_000 },
]) {
  assert.throws(() => decodeMcpCursor(cursor, "secret-that-is-long-enough", check));
}
assert.throws(() => decodeMcpCursor(`${cursor}x`, "secret-that-is-long-enough", {
  userId: "user-a", tool: "weekly", argsHash: "hash-a", nowSeconds: 1_100,
}));

console.log("MCP data checks passed");
