import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { getClient, isApiKeyConfigured, STRUCTURE_MODEL } from "@/lib/anthropic";
import {
  BIG_STRUCTURE_EXTRACTION_PROMPT,
  PROFILE_EXTRACTION_PROMPT,
  STRUCTURE_EXTRACTION_PROMPT,
} from "@/lib/prompts/extraction";
import { PHASE_META } from "@/lib/prompts/phases";
import { COACHES } from "@/lib/prompts/coaches";
import type { CoachId, ChatMessage, StoryMode } from "@/types/goal";

export const runtime = "nodejs";
export const maxDuration = 60;

const GoalCardSchema = z.object({
  /** 内部用。各項目を書く前に対話の流れを整理させる。UIには出さない */
  flowSummary: z.string(),
  visionRaw: z.string(),
  /** 観点を変えた3案。決めるのは本人 */
  visionOptions: z.array(z.string()),
  meaning: z.object({
    whyChain: z.array(z.string()),
    values: z.array(z.string()),
    motivationType: z.enum(["internal", "external", "avoidance"]),
    reframed: z.string().nullable(),
    reframedFrom: z.string().nullable(),
  }),
  smart: z.object({
    specificOptions: z.array(z.string()),
    measurableOptions: z.array(z.string()),
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
  /** この目標が大きな物語にどう効くか。ツリーの辺のラベルになる。3案 */
  rationaleOptions: z.array(z.string()),
});

const ProfileSchema = z.object({
  lifePatterns: z.array(z.string()),
  pastFailures: z.array(z.string()),
  valuesAccumulated: z.array(z.string()),
});

const BigStorySchema = z.object({
  /**
   * 内部用。各項目を書く前に対話の流れを整理させる。
   * 先に全体を振り返らせないと、直近の発言を切り貼りしただけの
   * 成果物になりやすい。UIには出さない。
   */
  flowSummary: z.string(),
  horizonYears: z.number(),
  visionRaw: z.string(),
  /** 観点を変えた3案。決めるのは本人 */
  visionOptions: z.array(z.string()),
  /** 3案。各案は「 / 」区切りの一行にする */
  valuesOptions: z.array(z.string()),
  currentPositionOptions: z.array(z.string()),
  milestones: z.array(
    z.object({
      label: z.string(),
      state: z.string(),
    }),
  ),
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
      const [bigRes, profileRes] = await Promise.all([
        client.messages.parse({
          model: STRUCTURE_MODEL,
          // 各項目3案ぶんの日本語を出すので余裕を持たせる。
          // 足りないと途中で切れて parsed_output が null になる
          max_tokens: 12000,
          system: BIG_STRUCTURE_EXTRACTION_PROMPT,
          messages: [{ role: "user", content: transcript }],
          output_config: { format: zodOutputFormat(BigStorySchema) },
        }),
        client.messages.parse({
          model: STRUCTURE_MODEL,
          max_tokens: 2000,
          system: PROFILE_EXTRACTION_PROMPT,
          messages: [{ role: "user", content: transcript }],
          output_config: { format: zodOutputFormat(ProfileSchema) },
        }),
      ]);

      if (!bigRes.parsed_output) {
        return Response.json(
          { error: "parse_failed", message: "対話の整理に失敗しました。" },
          { status: 502 },
        );
      }

      return Response.json({
        bigStory: bigRes.parsed_output,
        profile: profileRes.parsed_output ?? {
          lifePatterns: [],
          pastFailures: [],
          valuesAccumulated: [],
        },
      });
    }

    // 目標カードとプロフィールは別スキーマなので2回に分ける。
    // どちらも1セッションに1回だけなのでコストは小さい。
    const [cardRes, profileRes] = await Promise.all([
      client.messages.parse({
        model: STRUCTURE_MODEL,
        // 各項目3案ぶんの日本語を出すので余裕を持たせる
        max_tokens: 16000,
        system: body.bigStorySummary
          ? `${STRUCTURE_EXTRACTION_PROMPT}\n\n【大きな物語】\n${body.bigStorySummary}`
          : STRUCTURE_EXTRACTION_PROMPT,
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
