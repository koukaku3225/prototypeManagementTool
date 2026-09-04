import Anthropic from "@anthropic-ai/sdk";
import { CHAT_MODEL, getClient, isApiKeyConfigured } from "@/lib/anthropic";
import { ChatRequestSchema, parseBody } from "@/lib/api-schema";
import {
  buildSystem,
  toCachedMessages,
  type ChatRequest,
} from "@/lib/chat-prompt";
import { PhaseTokenFilter, resolvePhase } from "@/lib/phase-machine";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { checkRateLimit, getCallerId } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * 未指定だとプラットフォーム既定（Vercel Hobby は10秒）に従い、
 * 生成の途中で関数ごと切られる。切られると done イベントが飛ばず、
 * クライアントは status="streaming" のまま固まる。
 * structure 側と揃えて明示する。
 */
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = await requireAuthIfEnabled();
  if (denied) return denied;

  // Anthropic呼び出し（課金発生）の直前で、回数だけ先に弾く。
  // Upstash未設定のローカル開発では常に通る（checkRateLimit参照）
  const limited = await checkRateLimit(await getCallerId(req), "chat");
  if (limited) return limited;

  if (!isApiKeyConfigured()) {
    return Response.json(
      { error: "config", message: "ANTHROPIC_API_KEY が設定されていません。" },
      { status: 500 },
    );
  }

  const parsed = await parseBody(req, ChatRequestSchema);
  if (!parsed.ok) {
    return Response.json({ error: "bad_request" }, { status: parsed.status });
  }
  // スキーマを通っているので coachId / phase / turnsInPhase は妥当。
  // ここから先で存在チェックをやり直す必要はない
  const body = parsed.data as ChatRequest;

  const client = getClient();

  /**
   * req.signal を渡すのが要。クライアントが切ると Anthropic 側の生成も止まる。
   * 渡さないと、画面を離れても連投しても、捨てるだけの応答を最後まで
   * 生成しきって課金される。useConversation は送信のたびに前のリクエストを
   * abort するので、これは異常系ではなく日常的に起きる。
   */
  const stream = client.messages.stream(
    {
      model: CHAT_MODEL,
      max_tokens: 1024, // コーチの発言は3文以内。小さく抑える
      system: buildSystem(body),
      messages: toCachedMessages(body.messages),
    },
    { signal: req.signal },
  );

  const filter = new PhaseTokenFilter();
  const encoder = new TextEncoder();

  const sse = new ReadableStream({
    async start(controller) {
      /**
       * 閉じた stream への enqueue は例外を投げる。包まないと、
       * catch の send("error") がさらに投げ、finally の close() も投げて、
       * 元のエラーが握りつぶされる。送れないのは「相手がもういない」だけで、
       * こちら側の異常ではないので黙って捨ててよい。
       */
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          /* すでに閉じている */
        }
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
          mode: body.mode,
          current: body.phase,
          claimed: filter.phase,
          turnsInPhase: body.turnsInPhase + 1,
        });

        const final = await stream.finalMessage();
        send("done", {
          phase: resolved.phase,
          forced: resolved.forced,
          usage: {
            at: new Date().toISOString(),
            model: CHAT_MODEL,
            kind: body.phase,
            input: final.usage.input_tokens,
            output: final.usage.output_tokens,
            cacheRead: final.usage.cache_read_input_tokens ?? 0,
            cacheWrite: final.usage.cache_creation_input_tokens ?? 0,
          },
        });
      } catch (err) {
        // 中断は異常ではない。クライアントはもういないので何も送らない
        if (!isAborted(err)) send("error", { message: describeError(err) });
      } finally {
        try {
          controller.close();
        } catch {
          /* すでに閉じている */
        }
      }
    },

    /**
     * クライアントが切断したときに呼ばれる。ここで上流も止める。
     * これが無いと signal を渡していても、SSE を読むのをやめただけの
     * ケース（タブを閉じる等）で生成が走り続ける。
     */
    cancel() {
      stream.abort();
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

/**
 * 中断によるエラーか。
 * 中断は「ユーザーが次の発言を送った」「タブを閉じた」で日常的に起きるので、
 * エラーとして扱わない。SDK は APIUserAbortError を、fetch 層は
 * name="AbortError" を投げるため両方見る。
 */
function isAborted(err: unknown): boolean {
  if (err instanceof Anthropic.APIUserAbortError) return true;
  return err instanceof Error && err.name === "AbortError";
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
