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
 * small は diverge/smart/woop_wbs の3ステップで最大19ターン。
 * 以前は5フェーズ最大39ターンあり「いつまで続くのか分からない」という
 * 実使用フィードバックを受けて短縮した（meaning/reframe は big 側に集約）。
 * meaning/reframe の値はレガシーセッションの再生用に残している。
 */
export const PHASE_TURN_LIMIT: Record<PhaseId, number> = {
  diverge: 4,
  meaning: 10,
  reframe: 6,
  smart: 5,
  /**
   * woop_wbs は障害 → 状況 → If-Then → タスク選び → いつ・どこで の5手。
   * 5 のままだと、最後の「いつ・どこで」を聞く手前で強制遷移してしまい、
   * 実行意図が空のまま完了する（実機で確認した不具合）。
   * 7 でも、口火の1ターンを足すと問い直しゼロのときしか収まらず、
   * If-Then や「夜は何時ごろ」を1回問い直しただけで「どこで」の手前で
   * 打ち切られていた（R10）。指示文が求める問い直しを入れても届く 10。
   * 長さが気になる人向けには、対話画面に「切り上げて次へ」を置いてある。
   */
  woop_wbs: 10,
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
  /** この物語を生んだ対話。あとから読み返せるようにする */
  sessionId?: string | null;
}

/**
 * 週・月単位の中間目標。
 *
 * 大きな物語（1〜10年）とSmall目標（GoalCard、締切は1点のみ）の間に、
 * 期間を持つ段が無かった。GoalCardに配列で埋め込まないのは、
 * upsertCard がカード全体を置換するため（AGENTS.md「GoalCardに日々ログを
 * 埋め込まない」）。BigStory.milestones（物語の中の見出し的な節目、
 * {label, state}）とは別物なので、名前を分けてある。
 *
 * ライフサイクルがGoalCard確定時の一回性の対話と異なり、週〜月ごとに
 * 随時追加・更新するものなので、対話フェーズには組み込まず手動UIで完結させる。
 */
export type CheckpointPeriodKind = "week" | "month";

export interface CheckpointPeriod {
  kind: CheckpointPeriodKind;
  /** ローカル日付（YYYY-MM-DD）。含む */
  start: string;
  /** ローカル日付（YYYY-MM-DD）。含む */
  end: string;
}

/**
 * 3値なのは、達成/未達成の二値評価がオール・オア・ナッシング思考を招き、
 * 少しの停滞で放棄されやすいという知見（2026-09-13 調査）を踏まえたため。
 * "abandoned" は失敗ではなく「今回は終わりにする」という通常の選択として扱う。
 */
export type CheckpointStatus = "active" | "done" | "abandoned";

/**
 * 中期目標の建て方の自己評価。
 *
 * 3軸（動機・価値観・人との関わり）は性質が違うので1つの点数に
 * 合算しない。合算すると「何が良くて何が悪いか」が分からなくなる
 * （2026-09-13 の知識収集・設計を踏まえた判断）。
 *
 * TimeBox.review と同じく、埋め込みにしてある。頻繁に書き換わる
 * ログではなく、その中期目標のライフサイクルに1つ紐づく自己評価のため。
 * 任意項目なので、既存のCheckpointにはこのフィールド自体が無い。
 */
export interface CheckpointEvaluation {
  /**
   * セルフコンコーダンスモデル（Sheldon & Elliot）の4動機。各1〜10。
   * 未評価は4つとも5（中立）から始めるので、スコアは常に計算できる。
   */
  motives: {
    /** 同一化動機:自分で選んだと言えるか */
    identified: number;
    /** 内的動機:やっている最中が楽しいか */
    intrinsic: number;
    /** 取入的動機:やらないと落ち着かない、という焦りからではないか */
    introjected: number;
    /** 外的動機:誰かの目や見返りが理由になっていないか */
    external: number;
  };
  /** 大きな物語の価値観のうち、この目標が効くと感じるもの */
  linkedValues: string[];
  /** なぜそれが大事か。一言でよい */
  whyItMatters: string;
  /** 一緒にやる人・報告する相手がいるか */
  hasBuddy: boolean;
  buddyNote: string;
  updatedAt: string;
}

export const emptyCheckpointEvaluation = (): CheckpointEvaluation => ({
  motives: { identified: 5, intrinsic: 5, introjected: 5, external: 5 },
  linkedValues: [],
  whyItMatters: "",
  hasBuddy: false,
  buddyNote: "",
  updatedAt: new Date().toISOString(),
});

export interface Checkpoint {
  id: string;
  /** GoalCard.id 必須。孤児の中間目標は作らない（Habit.cardIdと同じ思想） */
  cardId: string;
  title: string;
  period: CheckpointPeriod;
  status: CheckpointStatus;
  /** 任意。建て方を評価したときだけ入る */
  evaluation?: CheckpointEvaluation | null;
  /**
   * 進み具合の測り方（中間目標タブ、2026-09-17）。無ければ "done"（それまでの中間目標）。
   * 目標を今日の予定までつなげるには、「どこまで進んだか」が数で見える必要がある。
   */
  measure?: CheckpointMeasure;
  /** 目安。time は時間数、count は回数。done では使わない */
  target?: number | null;
  /** 回数を手で＋1したぶん（予定にしない行動を数えるため） */
  manualCount?: number;
  /** 振り返りで続けたときの、引き継ぎ元の中間目標 */
  previousId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** time: 紐づけた予定の時間／count: 完了した予定の数＋手で足した数／done: できたかどうか */
export type CheckpointMeasure = "time" | "count" | "done";

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
  /** この目標を生んだ対話。あとから読み返せるようにする */
  sessionId?: string | null;
  /**
   * 一覧・選択肢に出す短い呼び名（例:「副業」「異性関係」）。
   * vision.refined はカードの中身を正確に言い切ろうとして長くなりやすく、
   * 目標が複数あるとタイムボックスの選択肢欄でどれがどれか見分けがつかない。
   * 未設定でも動く（vision から自動で短くした表示に落ちる）ので既存データは壊れない。
   */
  label?: string | null;

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

/**
 * M8: 1回のAPI呼び出しのトークン内訳。
 *
 * 入力トークンは3種類あり、単価が10倍以上違う。合計だけ見ても
 * 改善したかどうか分からないので、必ず分けて記録する。
 * - input     … キャッシュに載らなかった入力。定価
 * - cacheRead … キャッシュから読めた入力。定価の 1/10
 * - cacheWrite… キャッシュへ書いた入力。5m なら定価の1.25倍、1h なら2倍
 */
export interface TokenUsage {
  at: string;
  model: string;
  /** どの呼び出しか。対話ターンはフェーズID、最後の整理は "structure" */
  kind: AnyPhaseId | "structure";
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
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
  /**
   * 理想を考える時間を切り上げた時刻。
   * リロードでタイマーが復活しないように残す。null なら未通過。
   */
  thinkingDoneAt?: string | null;
  /** M8: このセッションで消費したトークン。1呼び出し1件 */
  usage?: TokenUsage[];
  /**
   * 終わった対話を続きから再開した時刻。
   * これが入っているセッションは、完成時に新しい成果物を作らず
   * 元の成果物を上書きする。
   */
  resumedAt?: string | null;
}

export function emptyPhaseCounts(): Record<PhaseId, number> {
  return { diverge: 0, meaning: 0, reframe: 0, smart: 0, woop_wbs: 0 };
}
