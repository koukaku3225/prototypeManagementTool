import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getClient, isApiKeyConfigured, STRUCTURE_MODEL } from "@/lib/anthropic";
import {
  BigStorySchema,
  EMPTY_PROFILE,
  GoalCardSchema,
  usageOf,
} from "@/lib/structure-schema";
import {
  BIG_STRUCTURE_EXTRACTION_PROMPT,
  STRUCTURE_EXTRACTION_PROMPT,
} from "@/lib/prompts/extraction";
import { PHASE_META } from "@/lib/prompts/phases";
import { COACHES } from "@/lib/prompts/coaches";
import type { CoachId, ChatMessage, StoryMode } from "@/types/goal";

export const runtime = "nodejs";
export const maxDuration = 60;

function renderTranscript(messages: ChatMessage[], coachId: CoachId): string {
  const coachName = COACHES[coachId].name;
  const lines = messages.map((m) => {
    const who = m.role === "user" ? "ユーザー" : coachName;
    const phase = PHASE_META[m.phase].label;
    return `[${phase}] ${who}: ${m.content}`;
  });
  return `対話日: ${new Date().toISOString().slice(0, 10)}\n\n${lines.join("\n")}`;
}

export async function POST(req: Request) {
  if (!isApiKeyConfigured()) {
    return Response.json(
      { error: "config", message: "ANTHROPIC_API_KEY が設定されていません。" },
      { status: 500 },
    );
  }

  let body: {
    messages: ChatMessage[];
    coachId: CoachId;
    mode: StoryMode;
    /** small のとき、rationale を書くために渡す */
    bigStorySummary?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const transcript = renderTranscript(body.messages, body.coachId);
  const client = getClient();

  try {
    if (body.mode === "big") {
      const bigRes = await client.messages.parse({
        model: STRUCTURE_MODEL,
        // 各項目3案ぶんの日本語を出すので余裕を持たせる。
        // 足りないと途中で切れて parsed_output が null になる
        max_tokens: 12000,
        system: BIG_STRUCTURE_EXTRACTION_PROMPT,
        messages: [{ role: "user", content: transcript }],
        output_config: { format: zodOutputFormat(BigStorySchema) },
      });

      if (!bigRes.parsed_output) {
        return Response.json(
          { error: "parse_failed", message: "対話の整理に失敗しました。" },
          { status: 502 },
        );
      }

      const { profile, ...bigStory } = bigRes.parsed_output;
      return Response.json({
        bigStory,
        profile: profile ?? EMPTY_PROFILE,
        usage: usageOf(bigRes, STRUCTURE_MODEL),
      });
    }

    // 目標カードとプロフィールは1回の呼び出しで同時に取る。
    // 分けると同じ対話ログを2回送ることになり、入力トークンが倍かかる。
    const cardRes = await client.messages.parse({
      model: STRUCTURE_MODEL,
      // 各項目3案ぶんの日本語を出すので余裕を持たせる
      max_tokens: 16000,
      system: body.bigStorySummary
        ? `${STRUCTURE_EXTRACTION_PROMPT}\n\n【大きな物語】\n${body.bigStorySummary}`
        : STRUCTURE_EXTRACTION_PROMPT,
      messages: [{ role: "user", content: transcript }],
      output_config: { format: zodOutputFormat(GoalCardSchema) },
    });

    if (!cardRes.parsed_output) {
      return Response.json(
        { error: "parse_failed", message: "対話の整理に失敗しました。" },
        { status: 502 },
      );
    }

    const { profile, ...card } = cardRes.parsed_output;
    return Response.json({
      card,
      profile: profile ?? EMPTY_PROFILE,
      usage: usageOf(cardRes, STRUCTURE_MODEL),
    });
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? (err.status ?? 500) : 500;
    return Response.json(
      { error: "upstream", message: describeError(err) },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) {
    return "少し混み合っています。少し待ってからもう一度お試しください。";
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "APIキーが無効です。設定を確認してください。";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "接続できませんでした。もう一度お試しください。";
  }
  return "対話の整理に失敗しました。";
}
