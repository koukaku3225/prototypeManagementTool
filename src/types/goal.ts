/** 目標トラッキングツール — MVP コアデータモデル */

export type MotivationType = "internal" | "external" | "avoidance";
export type PhaseId = "diverge" | "meaning" | "reframe" | "smart" | "woop_wbs";
export type CoachId = "kaede" | "rin" | "sou" | "nagi" | "hinata" | "kuro";

export const PHASE_ORDER: readonly PhaseId[] = [
  "diverge",
  "meaning",
  "reframe",
  "smart",
  "woop_wbs",
] as const;

/**
 * 待ち時間ロックを発動するフェーズ。
 *
 * 空 ＝ 現在は無効。60秒の強制待機は「イライラする」「いつまで続くのか」
 * という実使用の声を受けて廃止した。仕組み自体は A/B の枠組みとして残してある。
 */
export const DELAY_PHASES: readonly PhaseId[] = [] as const;

/**
 * 堂々巡り防止のための最大ターン数。超えたらシステム側で強制遷移する。
 *
 * small は diverge/smart/woop_wbs の3ステップで最大13ターン。
 * 以前は5フェーズ最大39ターンあり「いつまで続くのか分からない」という
 * 実使用フィードバックを受けて短縮した（meaning/reframe は big 側に集約）。
 * meaning/reframe の値はレガシーセッションの再生用に残している。
 */
export const PHASE_TURN_LIMIT: Record<PhaseId, number> = {
  diverge: 4,
  meaning: 10,
  reframe: 6,
  smart: 5,
  woop_wbs: 5,
};

/**
 * 各フェーズを抜けるのに最低限必要なターン数。
 *
 * 1ターン目は「そのフェーズの問いかけ」自体が消費する（ユーザーは未回答）。
 * したがって「ユーザーが1回答えたら進んでよい」は min=2 で表す。
 */
export const PHASE_TURN_MIN: Record<PhaseId, number> = {
  diverge: 2,
  meaning: 3,
  reframe: 2,
  smart: 3,
  woop_wbs: 3,
};

export type StoryMode = "big" | "small";
export type BigPhaseId = "big_vision" | "big_why" | "big_position";
export type AnyPhaseId = PhaseId | BigPhaseId;

export const MAX_SMALL_STORIES = 3;

/**
 * small の対話ステップ。
 *
 * 「なぜ大事か」（meaning / reframe）は big 側の big_why で取得済みなので
 * small では掘り直さない。small は Big Story から絞り込んだ1件について
 * 「1〜3年後の理想の姿 → 具体化 → 障害と明日の一歩」だけを扱う。
 * PHASE_ORDER は過去セッションの再生とメトリクス用に残してある。
 */
export const SMALL_FLOW: readonly AnyPhaseId[] = [
  "diverge",
  "smart",
  "woop_wbs",
] as const;

export const FLOW: Record<StoryMode, readonly AnyPhaseId[]> = {
  small: SMALL_FLOW,
  big: ["big_vision", "big_why", "big_position"],
};

/**
 * カウントの注意: 各フェーズの最初のアシスタント発言（そのフェーズの問いかけ自体）が
 * ユーザーの回答なしに turnsInPhase を1消費する。そのため「ユーザーが1回答えたら
 * 進めてよい」を表すには min=2 が必要（1=問いかけ、2=回答を受けた返信）。
 * min=1 のままだとユーザーが答える前に強制終了しうる（実機検証で確認済みの不具合）。
 */
export const BIG_PHASE_TURN_MIN: Record<BigPhaseId, number> = {
  big_vision: 2,
  big_why: 2,
  big_position: 2,
};

export const BIG_PHASE_TURN_LIMIT: Record<BigPhaseId, number> = {
  big_vision: 3,
  big_why: 4,
  big_position: 3,
};

export type PhaseStatus = "done" | "current" | "upcoming" | "stale";

// ---------------------------------------------------------------- 成果物

export interface Task {
  id: string;
  title: string;
  estimateMin: number;
  dueDate: string; // ISO8601 date
  completedAt: string | null;
}

export interface BigStory {
  id: string;
  createdAt: string;
  updatedAt: string;
  coachId: CoachId;
  horizonYears: number;
  vision: { raw: string; refined: string };
  values: string[];
  currentPosition: string;
  milestones: { label: string; state: string }[];
  editedFields: string[];
}

export interface SmallStory {
  id: string;
  bigStoryId: string | null;
  title: string;
  rationale: string;
  flowNote: string;
  status: "proposed" | "active" | "done";
  cardId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface Obstacle {
  id: string;
  text: string; // 「帰宅後に疲れて手が止まる」
  situation: string; // 「平日21時以降、帰宅直後」
  plan: {
    if: string; // 「21時に机に座れなかったら」
    then: string; // 「翌朝6時に15分だけやる」
  };
}

/**
 * 対話（または手入力）から生まれる、ユーザーに見せる成果物。
 * これが「Small目標」の実体で、bigStoryId で大きな物語にぶら下がる。
 * 既存データを壊さないため、追加分はすべて任意にしてある。
 */
export interface GoalCard {
  id: string;
  createdAt: string;
  updatedAt: string;
  coachId: CoachId;

  /** どの大きな物語にぶら下がるか。単独の目標なら null */
  bigStoryId?: string | null;
  /** なぜこれが大きな物語に効くのか。ツリー表示で辺のラベルになる */
  rationale?: string;
  /** done は3枠を消費しない */
  status?: "active" | "done";
  /** 手入力で作ったか。対話由来と区別して表示する */
  source?: "dialogue" | "manual";

  vision: {
    raw: string; // ユーザーが最初に語った生の言葉
    refined: string; // 対話を経て磨かれた表現（内容は足さない）
  };

  meaning: {
    whyChain: string[];
    values: string[];
    motivationType: MotivationType;
    reframed: string | null;
    reframedFrom: string | null;
  };

  smart: {
    specific: string;
    measurable: string;
    metricUnit: string | null;
    metricTarget: number | null;
    deadline: string; // ISO8601 date
    achievableNote: string;
  };

  woop: {
    wish: string;
    outcome: string;
    obstacles: Obstacle[];
  };

  tasks: Task[]; // MVPでは常に1件

  commitment: {
    accepted: boolean;
    acceptedAt: string | null;
    userWords: string | null; // ユーザーが実際に打った同意の言葉
  };

  /** M5: AI出力の精度計測に使う。編集されたフィールドのパス */
  editedFields: string[];
}

/** 対話から裏で抽出され、次回以降の対話品質を上げる（＝自己分析モードの代替） */
export interface UserProfile {
  updatedAt: string;
  lifePatterns: string[];
  pastFailures: string[];
  valuesAccumulated: string[];
  communicationStyle: {
    avgResponseLength: number;
    prefersConcrete: boolean;
  };
}

// ---------------------------------------------------------------- 対話

/** 待ち時間中の入力挙動（H4検証用） */
export interface DraftEvents {
  lockDurationMs: number;
  charsTyped: number;
  charsDeleted: number;
  firstKeystrokeAtMs: number | null; // ロック開始からの経過。打鍵なしなら null
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  phase: AnyPhaseId;
  timestamp: string;
  draftEvents?: DraftEvents;
  invalidated?: boolean;
}

export interface ExperimentVariant {
  commitmentStep: boolean; // H3: 約束ステップ
  deliberateDelay: boolean; // H4: 意図的待ち時間
}

export interface Session {
  id: string;
  mode: StoryMode;
  coachId: CoachId;
  currentPhase: AnyPhaseId;
  phaseTurnCounts: Record<string, number>;
  phaseStatus: Partial<Record<AnyPhaseId, PhaseStatus>>;
  messages: ChatMessage[];
  startedAt: string;
  completedAt: string | null;
  variant: ExperimentVariant;
  /** フェーズごとの滞在時間計測（M3）。フェーズ開始時刻 */
  phaseEnteredAt: Partial<Record<AnyPhaseId, string>>;
}

export function emptyPhaseCounts(): Record<PhaseId, number> {
  return { diverge: 0, meaning: 0, reframe: 0, smart: 0, woop_wbs: 0 };
}
