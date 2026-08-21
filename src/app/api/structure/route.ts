import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getClient, isApiKeyConfigured, STRUCTURE_MODEL } from "@/lib/anthropic";
import {
  PROFILE_EXTRACTION_PROMPT,
  STRUCTURE_EXTRACTION_PROMPT,
} from "@/lib/prompts/extraction";
import { PHASE_META } from "@/lib/prompts/phases";
import { COACHES } from "@/lib/prompts/coaches";
import type { CoachId, ChatMessage } from "@/types/goal";

export const runtime = "nodejs";
export const maxDuration = 60;

const GoalCardSchema = z.object({
  vision: z.object({
    raw: z.string(),
    refined: z.string(),
  }),
  meaning: z.object({
    whyChain: z.array(z.string()),
    values: z.array(z.string()),
    motivationType: z.enum(["internal", "external", "avoidance"]),
    reframed: z.string().nullable(),
    reframedFrom: z.string().nullable(),
  }),
  smart: z.object({
    specific: z.string(),
    measurable: z.string(),
    metricUnit: z.string().nullable(),
    metricTarget: z.number().nullable(),
    deadline: z.string().nullable(),
    achievableNote: z.string(),
  }),
  woop: z.object({
    wish: z.string(),
    outcome: z.string(),
    obstacles: z.array(
      z.object({
        text: z.string(),
        situation: z.string(),
        plan: z.object({ if: z.string(), then: z.string() }),
      }),
    ),
  }),
  tasks: z.array(
    z.object({
      title: z.string(),
      estimateMin: z.number(),
    }),
  ),
  commitment: z.object({
    userWords: z.string().nullable(),
  }),
});

const ProfileSchema = z.object({
  lifePatterns: z.array(z.string()),
  pastFailures: z.array(z.string()),
  valuesAccumulated: z.array(z.string()),
});

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

  let body: { messages: ChatMessage[]; coachId: CoachId };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const transcript = renderTranscript(body.messages, body.coachId);
  const client = getClient();

  try {
    // 目標カードとプロフィールは別スキーマなので2回に分ける。
    // どちらも1セッションに1回だけなのでコストは小さい。
    const [cardRes, profileRes] = await Promise.all([
      client.messages.parse({
        model: STRUCTURE_MODEL,
        max_tokens: 8000,
        system: STRUCTURE_EXTRACTION_PROMPT,
        messages: [{ role: "user", content: transcript }],
        output_config: { format: zodOutputFormat(GoalCardSchema) },
      }),
      client.messages.parse({
        model: STRUCTURE_MODEL,
        max_tokens: 2000,
        system: PROFILE_EXTRACTION_PROMPT,
        messages: [{ role: "user", content: transcript }],
        output_config: { format: zodOutputFormat(ProfileSchema) },
      }),
    ]);

    if (!cardRes.parsed_output) {
      return Response.json(
        { error: "parse_failed", message: "対話の整理に失敗しました。" },
        { status: 502 },
      );
    }

    return Response.json({
      card: cardRes.parsed_output,
      profile: profileRes.parsed_output ?? {
        lifePatterns: [],
        pastFailures: [],
        valuesAccumulated: [],
      },
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
