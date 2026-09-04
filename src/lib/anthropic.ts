import Anthropic from "@anthropic-ai/sdk";

/**
 * サーバー側でのみ生成する。ANTHROPIC_API_KEY は環境から解決され、
 * NEXT_PUBLIC_ 接頭辞は絶対に付けない（クライアントに漏れるため）。
 */
let client: Anthropic | null = null;

export function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/** 対話ターン用 — 呼び出し回数が多いので最安モデル */
export const CHAT_MODEL = "claude-haiku-4-5";

/** 構造化抽出用 — 失敗コストが高いので上位モデル */
export const STRUCTURE_MODEL = "claude-sonnet-5";

export function isApiKeyConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
