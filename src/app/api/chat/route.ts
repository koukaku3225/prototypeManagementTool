import Anthropic from "@anthropic-ai/sdk";
import { CHAT_MODEL, getClient, isApiKeyConfigured } from "@/lib/anthropic";
import { COACHES } from "@/lib/prompts/coaches";
import { COACHING_PRINCIPLES } from "@/lib/prompts/principles";
import {
  CLOSING_INSTRUCTION,
  COMMITMENT_INSTRUCTION,
  PHASE_INSTRUCTIONS,
} from "@/lib/prompts/phases";
import { PhaseTokenFilter, resolvePhase } from "@/lib/phase-machine";
import type { CoachId, PhaseId, UserProfile } from "@/types/goal";

export const runtime = "nodejs";

interface ChatRequest {
  coachId: CoachId;
  phase: PhaseId;
  turnsInPhase: number;
  messages: { role: "user" | "assistant"; content: string }[];
  profile: UserProfile | null;
  /** variant.commitmentStep。最終フェーズの締め方を切り替える */
  commitmentStep: boolean;
}

function renderProfile(profile: UserProfile | null): string {
  if (!profile) {
    return `【ユーザープロフィール】
まだ情報がない。初回の対話。`;
  }
  const section = (title: string, items: string[]) =>
    items.length ? `${title}: ${items.join(" / ")}` : `${title}: （未取得）`;

  return `【ユーザープロフィール】
過去の対話から分かっていること。自然な形で1セッションに1〜2回だけ引用する。
毎回引用すると不自然になるので、使いすぎないこと。

${section("生活パターン", profile.lifePatterns)}
${section("過去の挫折", profile.pastFailures)}
${section("大事にしているもの", profile.valuesAccumulated)}`;
}

export async function POST(req: Request) {
  if (!isApiKeyConfigured()) {
    return Response.json(
      { error: "config", message: "ANTHROPIC_API_KEY が設定されていません。" },
      { status: 500 },
    );
  }

  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const coach = COACHES[body.coachId];
  if (!coach) return Response.json({ error: "bad_request" }, { status: 400 });

  const isFinalTurn =
    body.phase === "woop_wbs" && body.turnsInPhase >= 3;

  const client = getClient();

  const stream = client.messages.stream({
    model: CHAT_MODEL,
    max_tokens: 1024, // コーチの発言は3文以内。小さく抑える
    system: [
      // ---- ここから下は不変。プロンプトキャッシュの対象にする ----
      { type: "text", text: COACHING_PRINCIPLES },
      { type: "text", text: coach.persona },
      {
        type: "text",
        text: renderProfile(body.profile),
        cache_control: { type: "ephemeral" },
      },
      // ---- ここから上は毎ターン差し替わる ----
      { type: "text", text: PHASE_INSTRUCTIONS[body.phase] },
      ...(isFinalTurn
        ? [
            {
              type: "text" as const,
              text: body.commitmentStep
                ? COMMITMENT_INSTRUCTION
                : CLOSING_INSTRUCTION,
            },
          ]
        : []),
    ],
    messages: body.messages.length
      ? body.messages
      : [{ role: "user", content: "（対話を始めてください）" }],
  });

  const filter = new PhaseTokenFilter();
  const encoder = new TextEncoder();

  const sse = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        for await (const ev of stream) {
          if (
            ev.type === "content_block_delta" &&
            ev.delta.type === "text_delta"
          ) {
            const visible = filter.push(ev.delta.text);
            if (visible) send("delta", { text: visible });
          }
        }

        const tail = filter.flush();
        if (tail) send("delta", { text: tail });

        const resolved = resolvePhase({
          current: body.phase,
          claimed: filter.phase,
          turnsInPhase: body.turnsInPhase + 1,
        });

        const final = await stream.finalMessage();
        send("done", {
          phase: resolved.phase,
          forced: resolved.forced,
          usage: {
            input: final.usage.input_tokens,
            output: final.usage.output_tokens,
            cacheRead: final.usage.cache_read_input_tokens ?? 0,
          },
        });
      } catch (err) {
        send("error", { message: describeError(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/** SDKの型付き例外で分岐する。文字列マッチはしない。 */
function describeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) {
    return "少し混み合っています。数秒おいてもう一度送ってください。";
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "APIキーが無効です。設定を確認してください。";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "接続が切れました。もう一度送ってください。";
  }
  if (err instanceof Anthropic.APIError) {
    return `応答を取得できませんでした（${err.status ?? "?"}）。もう一度送ってください。`;
  }
  return "応答を取得できませんでした。もう一度送ってください。";
}
