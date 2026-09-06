import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpGoalsInputSchema, McpWeeklyInputSchema } from "@/lib/api-schema";

type Repository = {
  getGoals(input: z.infer<typeof McpGoalsInputSchema>): Promise<Record<string, unknown>>;
  getWeeklyActivity(input: z.infer<typeof McpWeeklyInputSchema>): Promise<Record<string, unknown>>;
};

export function createToolResult(value: Record<string, unknown>) {
  const output = {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > 64 * 1024) throw new Error("mcp_result_too_large");
  return output;
}

export function createGoalCoachMcpServer(repository: Repository) {
  const server = new McpServer({ name: "goal-coach", version: "1.0.0" });
  server.registerTool("get_goals", {
    title: "目標を取得",
    description: "認証中の本人が現在設定している目標を取得します。過去時点のスナップショットではありません。",
    inputSchema: McpGoalsInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (raw) => createToolResult(await repository.getGoals(McpGoalsInputSchema.parse(raw))));
  server.registerTool("get_weekly_activity", {
    title: "一週間の行動記録を取得",
    description: "指定日からJSTの7日間について、同期済みの習慣記録と時間割を取得します。未記録を未実施と断定せず、next_cursorがあれば全ページを取得してください。",
    inputSchema: McpWeeklyInputSchema.shape,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (raw) => createToolResult(await repository.getWeeklyActivity(McpWeeklyInputSchema.parse(raw))));
  return server;
}
