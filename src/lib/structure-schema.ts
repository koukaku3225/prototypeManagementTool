import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { TokenUsage } from "@/types/goal";

/**
 * 対話ログから成果物を組み立てるときの出力スキーマ。
 *
 * ルートから切り出してあるのは、実APIを叩いて
 * 「本当にこの形で返ってくるか」を確かめるスクリプトから使うため。
 */

/**
 * プロフィールは以前これだけを別の呼び出しで抽出していた。
 * 同じ対話ログをもう一度そのまま送ることになり、入力トークンが
 * 単純に2倍かかっていたので、成果物のスキーマに相乗りさせる。
 * 項目は末尾に置く（先に成果物を書かせ、そのあとで持ち越し情報を書かせる）。
 */
export const ProfileFields = {
  profile: z.object({
    lifePatterns: z.array(z.string()),
    pastFailures: z.array(z.string()),
    valuesAccumulated: z.array(z.string()),
  }),
};

export const EMPTY_PROFILE = {
  lifePatterns: [],
  pastFailures: [],
  valuesAccumulated: [],
};

export function usageOf(
  res: { usage: Anthropic.Usage },
  model: string,
): TokenUsage {
  return {
    at: new Date().toISOString(),
    model,
    kind: "structure",
    input: res.usage.input_tokens,
    output: res.usage.output_tokens,
    cacheRead: res.usage.cache_read_input_tokens ?? 0,
    cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
  };
}

/*
 * 文字列・配列の上限。
 *
 * api-schema.ts（クライアントからの入力）には上限があるのに、
 * ここ（AIの出力）には無かった。入力側は zod で絞っているので
 * 暴走はしにくいはずだが、抽出プロンプトの誤動作・モデル側の不具合・
 * 対話ログへの偽装（structure/route.ts の renderTranscript 参照）で
 * 長すぎる/壊れた値が返ってくる可能性はゼロではない。
 * そのまま localStorage・Supabase に一生残るので、保存前にここで丸めておく。
 */
const TEXT = z.string().max(2000);
const SHORT_TEXT = z.string().max(500);
const OPTIONS = z.array(z.string().max(300)).max(5);

export const GoalCardSchema = z.object({
  /** 内部用。各項目を書く前に対話の流れを整理させる。UIには出さない */
  flowSummary: z.string().max(3000),
  visionRaw: TEXT,
  /** 観点を変えた3案。決めるのは本人 */
  visionOptions: OPTIONS,
  meaning: z.object({
    whyChain: z.array(SHORT_TEXT).max(10),
    values: z.array(z.string().max(100)).max(20),
    motivationType: z.enum(["internal", "external", "avoidance"]),
    reframed: TEXT.nullable(),
    reframedFrom: TEXT.nullable(),
  }),
  smart: z.object({
    specificOptions: OPTIONS,
    measurableOptions: OPTIONS,
    metricUnit: z.string().max(50).nullable(),
    // NaN/Infinity や極端な値がそのまま集計・表示に流れないように絞る
    metricTarget: z.number().finite().min(-1_000_000).max(1_000_000).nullable(),
    // "2026-12-31" 形式のみ。date.ts の前提（文字列の辞書順比較）を守る
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    achievableNote: TEXT,
  }),
  woop: z.object({
    wish: TEXT,
    outcome: TEXT,
    obstacles: z
      .array(
        z.object({
          text: SHORT_TEXT,
          situation: SHORT_TEXT,
          plan: z.object({ if: SHORT_TEXT, then: SHORT_TEXT }),
        }),
      )
      .max(10),
  }),
  tasks: z
    .array(
      z.object({
        title: z.string().max(200),
        estimateMin: z.number().finite().min(0).max(24 * 60),
        /** 実行意図の「いつ」。"21:00" 形式。対話で決まっていなければ null */
        startTime: z.string().max(10).nullable(),
        /** 実行意図の「どこで」。対話で決まっていなければ null */
        where: z.string().max(200).nullable(),
      }),
    )
    .max(5),
  commitment: z.object({
    userWords: SHORT_TEXT.nullable(),
  }),
  /** この目標が大きな物語にどう効くか。ツリーの辺のラベルになる。3案 */
  rationaleOptions: OPTIONS,
  ...ProfileFields,
});

export const BigStorySchema = z.object({
  /**
   * 内部用。各項目を書く前に対話の流れを整理させる。
   * 先に全体を振り返らせないと、直近の発言を切り貼りしただけの
   * 成果物になりやすい。UIには出さない。
   */
  flowSummary: z.string().max(3000),
  horizonYears: z.number().finite().min(1).max(100),
  visionRaw: TEXT,
  /** 観点を変えた3案。決めるのは本人 */
  visionOptions: OPTIONS,
  /** 3案。各案は「 / 」区切りの一行にする */
  valuesOptions: z.array(z.string().max(300)).max(5),
  currentPositionOptions: OPTIONS,
  milestones: z
    .array(
      z.object({
        label: z.string().max(200),
        state: SHORT_TEXT,
      }),
    )
    .max(20),
  ...ProfileFields,
});
