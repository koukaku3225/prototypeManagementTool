import type Anthropic from "@anthropic-ai/sdk";
import { COACHES } from "@/lib/prompts/coaches";
import { COACHING_PRINCIPLES } from "@/lib/prompts/principles";
import {
  BIG_PHASE_INSTRUCTIONS,
  CLOSING_INSTRUCTION,
  COMMITMENT_INSTRUCTION,
  PHASE_INSTRUCTIONS,
} from "@/lib/prompts/phases";
import type {
  AnyPhaseId,
  BigPhaseId,
  BigStory,
  CoachId,
  PhaseId,
  StoryMode,
  UserProfile,
} from "@/types/goal";

/**
 * 対話1ターンぶんのプロンプトを組み立てる。
 *
 * ルートから切り出してあるのは、キャッシュ境界の置き方が
 * コストを何倍にも変えるのに、目で見ても効いているか分からないため。
 * 実APIを叩いて usage を確かめるスクリプトから直接呼べるようにしてある。
 */

/**
 * キャッシュの生存時間。
 *
 * 既定の5分では足りない。このアプリは考える時間を意図的に取らせる設計で、
 * 1ターンの間隔が5分を超えることが普通にある。切れた瞬間に
 * システムプロンプトと会話履歴が丸ごと定価で焼き直される。
 * 1h は書き込みが2倍かかるが、2回以上読めれば元が取れる。
 *
 * ■ ただし現状このアプリでは、以下のキャッシュ指定は一度も発動しない
 * claude-haiku-4-5 はプロンプト合計が 4096 トークンを超えないと
 * cache_control を黙って無視する（実測: 4024→無視 / 4112→キャッシュ）。
 * このアプリの1ターンは system 約1300 + 履歴で、8往復しても約2400。
 * 上限まで対話しても閾値に届かない。
 * エラーにならないので、tests/cache-check.mts を回さないと気づけない。
 *
 * それでも指定を残してあるのは、
 * - 発動しないあいだの余計なコストはゼロ
 * - プロンプトが伸びれば（人格の追加、履歴の長い対話）自動で効き始める
 * から。消すのではなく、効く条件を書き残しておく。
 */
export const CACHE: Anthropic.CacheControlEphemeral = {
  type: "ephemeral",
  ttl: "1h",
};

export interface ChatRequest {
  mode: StoryMode;
  coachId: CoachId;
  phase: AnyPhaseId;
  turnsInPhase: number;
  messages: { role: "user" | "assistant"; content: string }[];
  profile: UserProfile | null;
  /** small を Big Story の細分化として扱うために渡す。big モードでは null */
  bigStory: BigStory | null;
  /** variant.commitmentStep。最終フェーズの締め方を切り替える（smallモードのみ） */
  commitmentStep: boolean;
}

/**
 * small モードで「大きな物語のどこを削るか」をコーチに意識させるための文脈。
 * これが無いと small が Big Story と無関係な別の目標設定になってしまう。
 */
export function renderBigStory(big: BigStory | null): string {
  if (!big) {
    return `【大きな物語】
まだ設定されていない。今回は単独の目標として扱う。`;
  }
  const milestones = big.milestones.length
    ? big.milestones.map((m) => `- ${m.label}: ${m.state}`).join("\n")
    : "（未設定）";

  return `【大きな物語（Big Story）】
これはユーザーが別の対話で言葉にした ${big.horizonYears} 年スケールの理想像である。
今回の対話は、この物語を細分化して直近の一歩に落とすためのもの。
候補の提案・相槌・言い換えは、必ずこの物語と価値観に接続すること。

理想像: ${big.vision.refined || big.vision.raw}
大事にしているもの: ${big.values.join(" / ") || "（未取得）"}
今の立ち位置: ${big.currentPosition || "（未取得）"}
節目:
${milestones}`;
}

export function renderProfile(profile: UserProfile | null): string {
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

export function instructionsFor(mode: StoryMode, phase: AnyPhaseId): string {
  return mode === "big"
    ? BIG_PHASE_INSTRUCTIONS[phase as BigPhaseId]
    : PHASE_INSTRUCTIONS[phase as PhaseId];
}

/** small の最終フェーズで、締めの指示を足すターンかどうか */
export function isFinalTurn(body: ChatRequest): boolean {
  return (
    body.mode === "small" && body.phase === "woop_wbs" && body.turnsInPhase >= 3
  );
}

/**
 * system を組み立てる。並び順そのものが最適化になっている。
 *
 * キャッシュは「先頭からの一致」でしか効かないので、
 * 変わらないものほど前に置く。
 * 境界① 原則・人格・大きな物語・プロフィール … セッション中ずっと不変
 * 境界② フェーズ指示 … フェーズが変わるときだけ差し替わる
 * 境界の外 締めの指示 … 最終ターンだけ現れる
 */
export function buildSystem(body: ChatRequest): Anthropic.TextBlockParam[] {
  const coach = COACHES[body.coachId];

  return [
    { type: "text", text: COACHING_PRINCIPLES },
    { type: "text", text: coach.persona },
    ...(body.mode === "small"
      ? [{ type: "text" as const, text: renderBigStory(body.bigStory) }]
      : []),
    {
      type: "text",
      text: renderProfile(body.profile),
      cache_control: CACHE,
    },
    // 境界の外に置くと、同じフェーズの2〜10ターンのあいだ
    // この1000トークン級の指示を毎回定価で送ることになる
    {
      type: "text",
      text: instructionsFor(body.mode, body.phase),
      cache_control: CACHE,
    },
    ...(isFinalTurn(body)
      ? [
          {
            type: "text" as const,
            text: body.commitmentStep
              ? COMMITMENT_INSTRUCTION
              : CLOSING_INSTRUCTION,
          },
        ]
      : []),
  ];
}

/**
 * 会話履歴にキャッシュ境界を打つ。
 *
 * 境界を system の中だけに置くと、毎ターン伸びる messages が丸ごと
 * 定価で再送される（ターン数nに対して入力コストが O(n^2) になる）。
 *
 * 境界は最後の2つの発言に置く。
 * - 末尾 … 今回ぶんを書き込む。次のターンで読まれる
 * - 末尾-2 … 前のターンが末尾に打った境界と同じ位置。ここが読み出しの当たり所
 * 履歴が短いうちはキャッシュの最小トークン数に届かず素通りするが、
 * その場合でもエラーにはならず、単に効かないだけ。
 */
export function toCachedMessages(
  msgs: { role: "user" | "assistant"; content: string }[],
): Anthropic.MessageParam[] {
  const src = msgs.length
    ? msgs
    : [{ role: "user" as const, content: "（対話を始めてください）" }];

  const marks = new Set<number>([src.length - 1]);
  if (src.length >= 3) marks.add(src.length - 3);

  return src.map((m, i) => ({
    role: m.role,
    content: [
      {
        type: "text" as const,
        text: m.content,
        ...(marks.has(i) ? { cache_control: CACHE } : {}),
      },
    ],
  }));
}
