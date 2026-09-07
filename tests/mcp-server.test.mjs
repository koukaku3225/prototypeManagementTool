import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGoalCoachMcpServer, createToolResult } from "../src/lib/mcp/server.ts";

const repository = {
  async getGoals(input) { return { schema_version: 1, input, goals: [{ id: "goal-a" }] }; },
  async getWeeklyActivity(input) { return { schema_version: 1, input, items: [] }; },
};
const server = createGoalCoachMcpServer(repository);
const client = new Client({ name: "mcp-test", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

const tools = await client.listTools();
assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ["get_goals", "get_weekly_activity"]);
assert.equal(tools.tools.every((tool) => tool.annotations?.readOnlyHint === true), true);
const result = await client.callTool({ name: "get_goals", arguments: { include_big_story: true } });
assert.equal(result.isError, undefined);
assert.equal(result.structuredContent.goals[0].id, "goal-a");
const invalid = await client.callTool({ name: "get_weekly_activity", arguments: { week_start: "2026-02-30" } });
assert.equal(invalid.isError, true);
assert.ok(Buffer.byteLength(JSON.stringify(createToolResult({ value: "x".repeat(20_000) })), "utf8") < 64 * 1024);
assert.throws(() => createToolResult({ value: "x".repeat(40_000) }), /mcp_result_too_large/);

await client.close();
await server.close();
console.log("MCP server protocol checks passed");
