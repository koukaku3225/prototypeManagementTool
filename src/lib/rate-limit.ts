import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Anthropic APIは従量課金で、呼び出し回数に上限が無いと費用が青天井になる。
 * ここは「誰かに公開URLを連打された」ときの最終防衛ラインの1つ
 * （Anthropicコンソール側の支出上限が最後の砦、REQUIRE_AUTHが未ログイン締め出し、
 * これはログイン済み・未ログイン問わず「回数」で締め出す）。
 *
 * ■ Upstash未設定の開発環境では、そもそも制限をかけない
 * REQUIRE_AUTH と同じ考え方。ローカルでは竜一さん自身が日常的に使うので、
 * Upstashのアカウントを作るまでは無制限のままでよい。
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN が
 * 両方そろって初めて有効化される。
 *
 * ■ 本番で Upstash が使えないときは、無制限にせず控えめな代替上限で数える
 * （セキュリティレビュー指摘4）。以前は「確認できなければ通す」だったので、
 * 設定漏れや障害の間は第三者が契約者負担で生成を繰り返せた。
 * 代替上限はサーバーのインスタンスごとのメモリで数えるため厳密ではないが、
 * 無制限よりはずっと狭い。製品が丸ごと止まる（500）ことも避けられる。
 */
const configured =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

const redis = configured ? Redis.fromEnv() : null;

export type RateLimitKind = "chat" | "structure" | "mcp" | "mcp-entry" | "calendar";

/**
 * 種類ごとの上限。
 *
 * chatとstructureで分けているのは、structure は STRUCTURE_MODEL（上位モデル、
 * 1回の対話で数回しか呼ばれない）を使い、chat は CHAT_MODEL（最安モデル、
 * 1対話で何十回も呼ばれる）を使うため。
 *
 * mcp-entry は認証より前に数える入口の上限。無効なトークンでも毎回
 * 認証サーバーへの問い合わせが起きうるので、IP単位で緩く締める（指摘10）。
 * calendar は1回で最大500件の Google API 操作になりうる同期の回数（指摘12）。
 */
const LIMITS: Record<RateLimitKind, { perMinute: number; perDay: number }> = {
  chat: { perMinute: 5, perDay: 50 },
  structure: { perMinute: 5, perDay: 15 },
  mcp: { perMinute: 5, perDay: 500 },
  "mcp-entry": { perMinute: 60, perDay: 2000 },
  calendar: { perMinute: 10, perDay: 500 },
};


const upstash = redis
  ? Object.fromEntries(
      (Object.keys(LIMITS) as RateLimitKind[]).map((kind) => [
        kind,
        {
          minute: new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(LIMITS[kind].perMinute, "1 m"),
            // 既存の chat/structure/mcp の数え方（共通の分単位）を変えない
            prefix: kind === "mcp-entry" || kind === "calendar" ? `rl:min:${kind}` : "rl:min",
          }),
          day: new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(LIMITS[kind].perDay, "1 d"),
            prefix: `rl:day:${kind}`,
          }),
        },
      ]),
    ) as Record<RateLimitKind, { minute: Ratelimit; day: Ratelimit }>
  : null;

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
  return getIpId(req);
}

/** IPアドレスで数えるときのid。認証より前（MCPの入口）で使う */
export function getIpId(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${ip || "unknown"}`;
}

// ---------------------------------------------------------------- 代替上限（メモリ）

/**
 * 固定の窓で数える、ごく単純な上限。1インスタンスの中だけで効く。
 * 窓の境目で最大2倍まで通るが、代替としてはそれで足りる。
 */
const memoryCounters = new Map<string, { windowStart: number; count: number }>();
const MEMORY_MAX_KEYS = 10_000;

export function memoryLimit(
  key: string,
  limit: number,
  windowMs: number,
  cost: number,
  now: number = Date.now(),
): boolean {
  const c = memoryCounters.get(key);
  if (!c || now - c.windowStart >= windowMs) {
    // 数え先が増え続けてメモリを食わないよう、溢れたら古いものから捨てる
    if (!c && memoryCounters.size >= MEMORY_MAX_KEYS) {
      const oldest = memoryCounters.keys().next().value;
      if (oldest !== undefined) memoryCounters.delete(oldest);
    }
    memoryCounters.set(key, { windowStart: now, count: cost });
    return cost <= limit;
  }
  c.count += cost;
  return c.count <= limit;
}

/** テスト専用 */
export function __resetMemoryLimitForTest(): void {
  memoryCounters.clear();
}

function fallbackAllows(id: string, kind: RateLimitKind, cost: number): boolean {
  /*
   * 上限の値は通常と同じにする。これより狭くすると、障害の間は本人の対話
   * （1分に数回呼ぶ）まで止まる。インスタンスごとに数えるぶん実質は緩いが、
   * 「無制限」との差は十分に大きい。
   */
  const l = LIMITS[kind];
  // 両方数える（片方で弾かれても、もう片方も消費する。厳しめに倒す）
  const okMinute = memoryLimit(`${kind}:min:${id}`, l.perMinute, 60_000, cost);
  const okDay = memoryLimit(`${kind}:day:${id}`, l.perDay, 86_400_000, cost);
  return okMinute && okDay;
}

const limited = () =>
  Response.json(
    {
      error: "rate_limited",
      message: "少し時間をおいてから、もう一度お試しください。",
    },
    { status: 429 },
  );

/**
 * APIルートの先頭、requireAuthIfEnabled() の直後で呼ぶ。
 * 制限に達していれば返すべき Response、問題なければ null。
 *
 * cost は1回の要求で実際に行う処理の数（MCPのバッチなら件数）。
 * 1要求＝1回として数えると、20件のバッチで上限の20倍を実行できた（指摘11）。
 */
export async function checkRateLimit(
  id: string,
  kind: RateLimitKind,
  cost = 1,
): Promise<Response | null> {
  const rate = Math.max(1, Math.floor(cost));

  if (!upstash) {
    // 開発環境（Upstash未設定）は無制限。本番で未設定なら代替上限で数える
    if (process.env.NODE_ENV !== "production") return null;
    console.error(
      "[rate-limit] 本番で Upstash が未設定です。代替上限で数えます。" +
        "UPSTASH_REDIS_REST_URL / _TOKEN を設定してください。",
    );
    return fallbackAllows(id, kind, rate) ? null : limited();
  }

  let minute: { success: boolean };
  let day: { success: boolean };
  try {
    const l = upstash[kind];
    [minute, day] = await Promise.all([
      l.minute.limit(id, { rate }),
      l.day.limit(id, { rate }),
    ]);
  } catch (err) {
    /*
     * 制限を確認できなかった（Upstashのトークンが無効・障害・ネットワーク断）。
     * ここで例外を投げると、APIルートごと500になって対話が丸ごと使えなくなる。
     * 実際にそうなった: 本番のUpstashトークンが無効になっていて
     * 「WRONGPASS invalid or missing auth token」で /api/chat が全滅し、
     * 目標設定そのものができなくなった。
     *
     * かといって無制限で通すと、その間は費用の防衛線が消える。
     * 製品を止めず、無制限にもしない中間として、代替上限で数える。
     * 黙って切り替えず、必ずログに残す。
     */
    console.error(
      "[rate-limit] 制限を確認できませんでした。代替上限で数えます。" +
        "UPSTASH_REDIS_REST_URL / _TOKEN を確認してください:",
      err instanceof Error ? err.message : String(err),
    );
    return fallbackAllows(id, kind, rate) ? null : limited();
  }

  if (!minute.success || !day.success) return limited();
  return null;
}
