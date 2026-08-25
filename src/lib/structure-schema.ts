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

export const GoalCardSchema = z.object({
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
  ...ProfileFields,
});

export const BigStorySchema = z.object({
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
  ...ProfileFields,
});

