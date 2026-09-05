import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Anthropic APIは従量課金で、呼び出し回数に上限が無いと費用が青天井になる。
 * ここは「誰かに公開URLを連打された」ときの最終防衛ラインの1つ
 * （Anthropicコンソール側の支出上限が最後の砦、REQUIRE_AUTHが未ログイン締め出し、
 * これはログイン済み・未ログイン問わず「回数」で締め出す）。
 *
 * ■ Upstash未設定の環境（ローカル開発）では、そもそも制限をかけない
 * REQUIRE_AUTH と同じ考え方。ローカルでは竜一さん自身が日常的に使うので、
 * Upstashのアカウントを作るまでは無制限のままでよい。
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が
 * 両方そろって初めて有効化される。
 */
const configured =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

const redis = configured ? Redis.fromEnv() : null;

/** 瞬間的な連打（スクリプトによる自動連投など）を防ぐ */
const perMinute = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, "1 m"),
      prefix: "rl:min",
    })
  : null;

/**
 * 1日あたりの上限。chatとstructureで分けているのは、
 * structure は STRUCTURE_MODEL（上位モデル、1回の対話で数回しか呼ばれない）を使い、
 * chat は CHAT_MODEL（最安モデル、1対話で何十回も呼ばれる）を使うため。
 * 同じ回数上限にすると、structure 側が緩すぎる／chat 側が厳しすぎるになる。
 */
const perDayChat = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(50, "1 d"),
      prefix: "rl:day:chat",
    })
  : null;
const perDayStructure = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(15, "1 d"),
      prefix: "rl:day:structure",
    })
  : null;

export type RateLimitKind = "chat" | "structure";

/**
 * 呼び出し元を1つのidに解決する。
 *
 * ログイン済みならuserIdで数える（同じ人が違う回線から来ても正しく合算される）。
 * 未ログインならIPアドレスにフォールバックする
 * （Vercelはプロキシ経由のリクエストに x-forwarded-for を自動で付与する）。
 *
 * requireAuthIfEnabled() と同様に Supabase を呼ぶため、REQUIRE_AUTH=true の
 * ときは1リクエストにつき2回 auth.getUser() が走る。ここは意図的に分離している
 * ―― 認可の合否判定（require-auth.ts）と、計測用の識別子取得（ここ）は
 * 目的が違うので、無理に1箇所へ統合しない。追加コストはAnthropic呼び出しの
 * レイテンシに比べて無視できる。
 */
export async function getCallerId(req: Request): Promise<string> {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return `user:${user.id}`;
  } catch {
    /* 未ログイン・Supabase未設定でも続行できる。IPにフォールバックする */
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${ip ?? "unknown"}`;
}

/**
 * APIルートの先頭、requireAuthIfEnabled() の直後で呼ぶ。
 * 制限に達していれば返すべき Response、問題なければ null。
 *
 * Upstash未設定（ローカル開発）では常に null を返し、無制限のまま通す。
 */
export async function checkRateLimit(
  id: string,
  kind: RateLimitKind,
): Promise<Response | null> {
  if (!redis || !perMinute) return null;

  const dayLimiter = kind === "chat" ? perDayChat! : perDayStructure!;

  let minute: { success: boolean };
  let day: { success: boolean };
  try {
    [minute, day] = await Promise.all([perMinute.limit(id), dayLimiter.limit(id)]);
  } catch (err) {
    /*
     * 制限を確認できなかった（Upstashのトークンが無効・障害・ネットワーク断）。
     * ここで例外を投げると、APIルートごと500になって対話が丸ごと使えなくなる。
     * 実際にそうなった: 本番のUpstashトークンが無効になっていて
     * 「WRONGPASS invalid or missing auth token」で /api/chat が全滅し、
     * 目標設定そのものができなくなった。
     *
     * 費用の防衛線はこれ1枚ではない。Anthropicコンソール側の支出上限が
     * 最後の砦としてあり、REQUIRE_AUTH が未ログインを締め出す。
     * この層が一時的に開くことより、製品が使えなくなることのほうが害が大きい。
     * よって「確認できなければ通す」。ただし黙って通さず、必ずログに残す。
     */
    console.error(
      "[rate-limit] 制限を確認できませんでした。無制限で通します。" +
        "UPSTASH_REDIS_REST_URL / _TOKEN を確認してください:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  if (!minute.success || !day.success) {
    return Response.json(
      {
        error: "rate_limited",
        message: "少し時間をおいてから、もう一度お試しください。",
      },
      { status: 429 },
    );
  }
  return null;
}
