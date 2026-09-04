import { z } from "zod";
import { COACHES } from "@/lib/prompts/coaches";
import { PHASE_META } from "@/lib/prompts/phases";
import { FLOW } from "@/types/goal";

/**
 * APIルートの入力スキーマ。
 *
 * これまで両ルートは `await req.json()` の結果に型注釈を付けただけで、
 * 実行時には何の保証もなかった。`{"coachId":"nope"}` を投げるだけで
 * `COACHES["nope"].name` が TypeError になり 500 になる。
 * zod は依存に入っているのに、Claude の「出力」検証にしか使っていなかった。
 *
 * ここで課しているのは正しさだけではない。messages の件数と文字数の上限は、
 * そのまま1リクエストあたりのトークン量の上限になる（＝コストの上限）。
 */

/** COACHES / PHASE_META の実体からそのまま作る。定義を二重に持たない */
const coachIds = Object.keys(COACHES) as [string, ...string[]];
const phaseIds = Object.keys(PHASE_META) as [string, ...string[]];

export const CoachIdSchema = z.enum(coachIds);
export const PhaseIdSchema = z.enum(phaseIds);
export const StoryModeSchema = z.enum(["big", "small"]);

/**
 * 1メッセージの上限。
 * 対話1発言としては十分に長く、悪用には短い。
 */
const MAX_CONTENT = 4000;
/**
 * 履歴の上限。
 * small は最大16ターン、big は最大10ターン。往復で数えても60あれば余る。
 * 続きから再開したセッションを考えて余裕を持たせてある。
 */
const MAX_MESSAGES = 60;

/** ボディ全体の上限。上の2つを掛けても届かない値にしておく */
export const MAX_BODY_BYTES = 200_000;

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_CONTENT),
  // クライアントは phase/timestamp も送ってくるが、下流で使うのは
  // role と content だけ。余分な項目は受け取っても無視する
});

/** 対話ログ。structure 側は phase を使って書き出すので、そちらは別に定義する */
const TranscriptMessageSchema = MessageSchema.extend({
  phase: PhaseIdSchema,
});

const ProfileSchema = z.object({
  updatedAt: z.string().max(40).optional(),
  lifePatterns: z.array(z.string().max(500)).max(30),
  pastFailures: z.array(z.string().max(500)).max(30),
  valuesAccumulated: z.array(z.string().max(500)).max(30),
  communicationStyle: z
    .object({
      avgResponseLength: z.number().int().min(0).max(100_000),
      prefersConcrete: z.boolean(),
    })
    .optional(),
});

const BigStorySchema = z.object({
  horizonYears: z.number().int().min(1).max(100),
  vision: z.object({
    raw: z.string().max(2000),
    refined: z.string().max(2000),
  }),
  values: z.array(z.string().max(200)).max(20),
  currentPosition: z.string().max(2000),
  milestones: z
    .array(
      z.object({ label: z.string().max(200), state: z.string().max(1000) }),
    )
    .max(20),
});

export const ChatRequestSchema = z
  .object({
    mode: StoryModeSchema,
    coachId: CoachIdSchema,
    phase: PhaseIdSchema,
    /**
     * SEC-05: クライアントが送ってくる値なので、そのまま信じない。
     * 上限を切っておけば「999 を送ってフェーズを即突破する」も
     * 「0 を送り続けて上限を来させない」も効かなくなる。
     */
    turnsInPhase: z.number().int().min(0).max(50),
    messages: z.array(MessageSchema).min(1).max(MAX_MESSAGES),
    profile: ProfileSchema.nullable(),
    bigStory: BigStorySchema.nullable(),
    commitmentStep: z.boolean(),
  })
  // phase はモードごとに取りうる値が違う。big の対話に small のフェーズを
  // 混ぜられると、噛み合わないプロンプトが組み上がる
  .refine((b) => (FLOW[b.mode] as readonly string[]).includes(b.phase), {
    message: "phase does not belong to mode",
    path: ["phase"],
  });

export const StructureRequestSchema = z.object({
  mode: StoryModeSchema,
  coachId: CoachIdSchema,
  messages: z.array(TranscriptMessageSchema).min(1).max(MAX_MESSAGES),
  bigStorySummary: z.string().max(4000).nullable().optional(),
});

/**
 * /api/local-backup の入力。captureState() の出力（キー→JSON文字列）を
 * そのまま受け取るだけなので形は緩いが、「zodを通す」規約はここでも守る。
 * バイト数の上限はルート側で持つ（対話全文まで含む丸ごとダンプなので、
 * 他の2ルートの MAX_BODY_BYTES よりずっと大きい値が要る）。
 */
export const LocalBackupSchema = z.record(z.string(), z.string());

export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
export type StructureRequestInput = z.infer<typeof StructureRequestSchema>;

/**
 * ボディを読んでサイズを見てから parse する。
 *
 * req.json() を先に呼ぶと、巨大なボディでも一旦メモリに展開されてしまう。
 * 先に文字列で受けて長さを見るほうが、弾くのが早い。
 */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<
  { ok: true; data: T } | { ok: false; status: 400 | 413 | 415 }
> {
  // SEC-10: text/plain の単純リクエストはプリフライトが飛ばない。
  // JSON を必須にするだけで、クロスサイトからの POST は塞げる
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) return { ok: false, status: 415 };

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, status: 400 };
  }
  if (raw.length > MAX_BODY_BYTES) return { ok: false, status: 413 };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400 };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, status: 400 };
  return { ok: true, data: parsed.data };
}
