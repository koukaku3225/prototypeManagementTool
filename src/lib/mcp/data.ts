import { createHmac, timingSafeEqual } from "node:crypto";

const CURSOR_TTL_SECONDS = 15 * 60;

export interface McpCursorPayload {
  userId: string;
  tool: "goals" | "weekly";
  argsHash: string;
  goalOffset?: number;
  habitOffset?: number;
  timeboxOffset?: number;
  exp?: number;
}

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signature(body: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(body).digest();
}

export function encodeMcpCursor(
  payload: McpCursorPayload,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const body = base64url(JSON.stringify({ ...payload, exp: nowSeconds + CURSOR_TTL_SECONDS }));
  return `${body}.${signature(body, secret).toString("base64url")}`;
}

export function decodeMcpCursor(
  cursor: string,
  secret: string,
  expected: { userId: string; tool: "goals" | "weekly"; argsHash: string; nowSeconds?: number },
): McpCursorPayload {
  const [body, provided, extra] = cursor.split(".");
  if (!body || !provided || extra) throw new Error("invalid_cursor");
  const actual = Buffer.from(provided, "base64url");
  const wanted = signature(body, secret);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) throw new Error("invalid_cursor");
  let payload: McpCursorPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as McpCursorPayload;
  } catch {
    throw new Error("invalid_cursor");
  }
  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (payload.userId !== expected.userId || payload.tool !== expected.tool ||
      payload.argsHash !== expected.argsHash || !payload.exp || payload.exp < now) {
    throw new Error("invalid_cursor");
  }
  return payload;
}

export function trimMcpText(value: unknown, max = 2000): { value: string; truncated: boolean } {
  const text = typeof value === "string" ? value : "";
  return text.length <= max
    ? { value: text, truncated: false }
    : { value: text.slice(0, max), truncated: true };
}

export function weekEndExclusive(start: string): string {
  const [year, month, day] = start.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + 7);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function mcpArgsHash(value: unknown): string {
  return createHmac("sha256", "mcp-args-v1").update(JSON.stringify(value)).digest("base64url");
}
