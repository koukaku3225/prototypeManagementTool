/** 目標トラッキングツール — MVP コアデータモデル */

export type MotivationType = "internal" | "external" | "avoidance";
export type PhaseId = "diverge" | "meaning" | "reframe" | "smart" | "woop_wbs";
export type CoachId = "kaede" | "rin" | "sou";

export const PHASE_ORDER: readonly PhaseId[] = [
  "diverge",
  "meaning",
  "reframe",
  "smart",
  "woop_wbs",
] as const;

/** 待ち時間ロックを発動するフェーズ（深さが要る2つに限定する） */
export const DELAY_PHASES: readonly PhaseId[] = ["meaning", "reframe"] as const;

/** 堂々巡り防止のための最大ターン数。超えたらシステム側で強制遷移する。 */
export const PHASE_TURN_LIMIT: Record<PhaseId, number> = {
  diverge: 6,
  meaning: 10,
  reframe: 6,
  smart: 9,
  woop_wbs: 8,
};

/** 各フェーズを抜けるのに最低限必要なターン数 */
export const PHASE_TURN_MIN: Record<PhaseId, number> = {
  diverge: 3,
  // 指示（phases.ts）は「なぜ」を3回問う設計。5にしていると
  // AIが3回で十分と判断しても水増しの深掘りを強制してしまうため3に合わせる。
  meaning: 3,
  reframe: 2,
  smart: 4,
  woop_wbs: 4,
};

// ---------------------------------------------------------------- 成果物

export interface Task {
  id: string;
  title: string;
  estimateMin: number;
  dueDate: string; // ISO8601 date
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

/** 対話から生成される、ユーザーに見せる成果物 */
export interface GoalCard {
  id: string;
  createdAt: string;
  updatedAt: string;
  coachId: CoachId;

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
  phase: PhaseId;
  timestamp: string;
  draftEvents?: DraftEvents;
}

export interface ExperimentVariant {
  commitmentStep: boolean; // H3: 約束ステップ
  deliberateDelay: boolean; // H4: 意図的待ち時間
}

export interface Session {
  id: string;
  coachId: CoachId;
  currentPhase: PhaseId;
  phaseTurnCounts: Record<PhaseId, number>;
  messages: ChatMessage[];
  startedAt: string;
  completedAt: string | null;
  variant: ExperimentVariant;
  /** フェーズごとの滞在時間計測（M3）。フェーズ開始時刻 */
  phaseEnteredAt: Partial<Record<PhaseId, string>>;
}

export function emptyPhaseCounts(): Record<PhaseId, number> {
  return { diverge: 0, meaning: 0, reframe: 0, smart: 0, woop_wbs: 0 };
}
