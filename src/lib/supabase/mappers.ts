/**
 * localStorage の形 ⇄ Supabase の行 の変換。
 *
 * ローカル側はネストしたオブジェクト（vision.raw など）、DB側はテーブル定義に
 * 合わせたフラット＋jsonb列。型がここでしか合流しないので、変換はこの1箇所に閉じる。
 * 呼び出し側（sync.ts）はこの関数を通すだけで、どちらの形も直接触らない。
 */
import type {
  BigStory,
  GoalCard,
  Session,
  UserProfile,
} from "@/types/goal";
import type { Habit, HabitLog } from "@/types/behavior";
import type { TimeBox } from "@/types/timebox";

export function bigStoryToRow(b: BigStory, userId: string) {
  return {
    id: b.id,
    user_id: userId,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
    coach_id: b.coachId,
    horizon_years: b.horizonYears,
    vision_raw: b.vision.raw,
    vision_refined: b.vision.refined,
    values: b.values,
    current_position: b.currentPosition,
    milestones: b.milestones,
    edited_fields: b.editedFields,
    session_id: b.sessionId ?? null,
  };
}

export function bigStoryFromRow(r: Record<string, unknown>): BigStory {
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    coachId: r.coach_id as BigStory["coachId"],
    horizonYears: r.horizon_years as number,
    vision: {
      raw: r.vision_raw as string,
      refined: r.vision_refined as string,
    },
    values: (r.values as string[]) ?? [],
    currentPosition: r.current_position as string,
    milestones: (r.milestones as BigStory["milestones"]) ?? [],
    editedFields: (r.edited_fields as string[]) ?? [],
    sessionId: (r.session_id as string | null) ?? null,
  };
}

export function goalCardToRow(c: GoalCard, userId: string) {
  return {
    id: c.id,
    user_id: userId,
    big_story_id: c.bigStoryId ?? null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    coach_id: c.coachId,
    rationale: c.rationale ?? "",
    status: c.status ?? "active",
    source: c.source ?? null,
    session_id: c.sessionId ?? null,
    label: c.label ?? null,
    vision_raw: c.vision.raw,
    vision_refined: c.vision.refined,
    meaning_why_chain: c.meaning.whyChain,
    meaning_values: c.meaning.values,
    motivation_type: c.meaning.motivationType,
    meaning_reframed: c.meaning.reframed,
    meaning_reframed_from: c.meaning.reframedFrom,
    smart_specific: c.smart.specific,
    smart_measurable: c.smart.measurable,
    smart_metric_unit: c.smart.metricUnit,
    smart_metric_target: c.smart.metricTarget,
    smart_deadline: c.smart.deadline || null,
    smart_achievable_note: c.smart.achievableNote,
    woop_wish: c.woop.wish,
    woop_outcome: c.woop.outcome,
    woop_obstacles: c.woop.obstacles,
    commitment_accepted: c.commitment.accepted,
    commitment_accepted_at: c.commitment.acceptedAt,
    commitment_user_words: c.commitment.userWords,
    edited_fields: c.editedFields,
  };
}

export function goalCardFromRow(r: Record<string, unknown>): GoalCard {
  return {
    id: r.id as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    coachId: r.coach_id as GoalCard["coachId"],
    bigStoryId: (r.big_story_id as string | null) ?? null,
    rationale: (r.rationale as string) ?? "",
    status: (r.status as GoalCard["status"]) ?? "active",
    source: (r.source as GoalCard["source"]) ?? undefined,
    sessionId: (r.session_id as string | null) ?? null,
    label: (r.label as string | null) ?? null,
    vision: {
      raw: r.vision_raw as string,
      refined: r.vision_refined as string,
    },
    meaning: {
      whyChain: (r.meaning_why_chain as string[]) ?? [],
      values: (r.meaning_values as string[]) ?? [],
      motivationType: r.motivation_type as GoalCard["meaning"]["motivationType"],
      reframed: (r.meaning_reframed as string | null) ?? null,
      reframedFrom: (r.meaning_reframed_from as string | null) ?? null,
    },
    smart: {
      specific: (r.smart_specific as string) ?? "",
      measurable: (r.smart_measurable as string) ?? "",
      metricUnit: (r.smart_metric_unit as string | null) ?? null,
      metricTarget: (r.smart_metric_target as number | null) ?? null,
      deadline: (r.smart_deadline as string) ?? "",
      achievableNote: (r.smart_achievable_note as string) ?? "",
    },
    woop: {
      wish: (r.woop_wish as string) ?? "",
      outcome: (r.woop_outcome as string) ?? "",
      obstacles: (r.woop_obstacles as GoalCard["woop"]["obstacles"]) ?? [],
    },
    commitment: {
      accepted: (r.commitment_accepted as boolean) ?? false,
      acceptedAt: (r.commitment_accepted_at as string | null) ?? null,
      userWords: (r.commitment_user_words as string | null) ?? null,
    },
    editedFields: (r.edited_fields as string[]) ?? [],
  };
}

export function habitToRow(h: Habit, userId: string) {
  return {
    id: h.id,
    user_id: userId,
    card_id: h.cardId,
    title: h.title,
    minimal_title: h.minimalTitle,
    estimate_min: h.estimateMin,
    schedule: h.schedule,
    start_time: h.startTime,
    location: h.where,
    cue: h.cue,
    created_at: h.createdAt,
    archived_at: h.archivedAt,
  };
}

export function habitFromRow(r: Record<string, unknown>): Habit {
  return {
    id: r.id as string,
    cardId: r.card_id as string,
    title: r.title as string,
    minimalTitle: (r.minimal_title as string) ?? "",
    estimateMin: r.estimate_min as number,
    schedule: r.schedule as Habit["schedule"],
    startTime: (r.start_time as string | null) ?? null,
    where: (r.location as string | null) ?? null,
    cue: (r.cue as string | null) ?? null,
    createdAt: r.created_at as string,
    archivedAt: (r.archived_at as string | null) ?? null,
  };
}

export function habitLogToRow(l: HabitLog, userId: string) {
  return {
    habit_id: l.habitId,
    user_id: userId,
    date: l.date,
    state: l.state,
    at: l.at,
    note: l.note,
    mood: l.mood,
  };
}

export function habitLogFromRow(r: Record<string, unknown>): HabitLog {
  return {
    habitId: r.habit_id as string,
    date: r.date as string,
    state: r.state as HabitLog["state"],
    at: r.at as string,
    note: (r.note as string | null) ?? null,
    mood: (r.mood as HabitLog["mood"]) ?? null,
  };
}

export function timeBoxToRow(b: TimeBox, userId: string) {
  return {
    id: b.id,
    user_id: userId,
    card_id: b.cardId,
    habit_id: b.habitId ?? null,
    date: b.date,
    start_time: b.start,
    end_time: b.end,
    title: b.title,
    color: b.color ?? null,
    meta: b.meta,
    completed_at: b.completedAt,
    review: b.review,
    created_at: b.createdAt,
  };
}

export function timeBoxFromRow(r: Record<string, unknown>): TimeBox {
  return {
    id: r.id as string,
    date: r.date as string,
    start: (r.start_time as string).slice(0, 5),
    end: (r.end_time as string).slice(0, 5),
    title: r.title as string,
    cardId: (r.card_id as string | null) ?? null,
    color: (r.color as string | null) ?? null,
    habitId: (r.habit_id as string | null) ?? null,
    meta: r.meta as TimeBox["meta"],
    completedAt: (r.completed_at as string | null) ?? null,
    review: (r.review as TimeBox["review"]) ?? null,
    createdAt: r.created_at as string,
  };
}

export function sessionToRow(s: Session, userId: string) {
  return {
    id: s.id,
    user_id: userId,
    mode: s.mode,
    coach_id: s.coachId,
    current_phase: s.currentPhase,
    phase_turn_counts: s.phaseTurnCounts,
    phase_status: s.phaseStatus,
    messages: s.messages,
    started_at: s.startedAt,
    completed_at: s.completedAt,
    variant: s.variant,
    phase_entered_at: s.phaseEnteredAt,
    thinking_done_at: s.thinkingDoneAt ?? null,
    resumed_at: s.resumedAt ?? null,
  };
}

export function sessionFromRow(r: Record<string, unknown>): Session {
  return {
    id: r.id as string,
    mode: r.mode as Session["mode"],
    coachId: r.coach_id as Session["coachId"],
    currentPhase: r.current_phase as Session["currentPhase"],
    phaseTurnCounts: (r.phase_turn_counts as Session["phaseTurnCounts"]) ?? {},
    phaseStatus: (r.phase_status as Session["phaseStatus"]) ?? {},
    messages: (r.messages as Session["messages"]) ?? [],
    startedAt: r.started_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
    variant: r.variant as Session["variant"],
    phaseEnteredAt: (r.phase_entered_at as Session["phaseEnteredAt"]) ?? {},
    thinkingDoneAt: (r.thinking_done_at as string | null) ?? null,
    resumedAt: (r.resumed_at as string | null) ?? null,
  };
}

/** token_usage は session.usage[] を正規化したもの。この向きだけで足りる（読み戻しは今回使わない） */
export function usageToRows(s: Session, userId: string) {
  return (s.usage ?? []).map((u) => ({
    session_id: s.id,
    user_id: userId,
    at: u.at,
    model: u.model,
    kind: u.kind,
    input: u.input,
    output: u.output,
    cache_read: u.cacheRead,
    cache_write: u.cacheWrite,
  }));
}

export function profileToRow(p: UserProfile, userId: string) {
  return {
    user_id: userId,
    updated_at: p.updatedAt,
    life_patterns: p.lifePatterns,
    past_failures: p.pastFailures,
    values_accumulated: p.valuesAccumulated,
    avg_response_length: p.communicationStyle.avgResponseLength,
    prefers_concrete: p.communicationStyle.prefersConcrete,
  };
}

export function profileFromRow(r: Record<string, unknown>): UserProfile {
  return {
    updatedAt: r.updated_at as string,
    lifePatterns: (r.life_patterns as string[]) ?? [],
    pastFailures: (r.past_failures as string[]) ?? [],
    valuesAccumulated: (r.values_accumulated as string[]) ?? [],
    communicationStyle: {
      avgResponseLength: (r.avg_response_length as number) ?? 0,
      prefersConcrete: (r.prefers_concrete as boolean) ?? false,
    },
  };
}
