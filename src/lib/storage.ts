"use client";

import {
  emptyPhaseCounts,
  type CoachId,
  type ExperimentVariant,
  type GoalCard,
  type Session,
  type UserProfile,
} from "@/types/goal";

const KEY = {
  session: "gc.session",
  card: "gc.card",
  profile: "gc.profile",
  variant: "gc.variant",
} as const;

/** localStorage は例外を投げうる（プライベートモード、容量超過）。必ず包む。 */
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 保存できなくても対話自体は続行できる */
  }
}

// ---------------------------------------------------------------- variant

/** A/B割り当ては初回だけ決めて固定する */
export function getVariant(): ExperimentVariant {
  const saved = read<ExperimentVariant>(KEY.variant);
  if (saved) return saved;
  const v: ExperimentVariant = {
    commitmentStep: Math.random() < 0.5,
    deliberateDelay: Math.random() < 0.5,
  };
  write(KEY.variant, v);
  return v;
}

/** 検証用: 手動でバリアントを固定する */
export function setVariant(v: ExperimentVariant): void {
  write(KEY.variant, v);
}

// ---------------------------------------------------------------- session

export function newSession(coachId: CoachId): Session {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    coachId,
    currentPhase: "diverge",
    phaseTurnCounts: emptyPhaseCounts(),
    messages: [],
    startedAt: now,
    completedAt: null,
    variant: getVariant(),
    phaseEnteredAt: { diverge: now },
  };
}

export const loadSession = () => read<Session>(KEY.session);
export const saveSession = (s: Session) => write(KEY.session, s);
export const clearSession = () => remove(KEY.session);

export const loadCard = () => read<GoalCard>(KEY.card);
export const saveCard = (c: GoalCard) => write(KEY.card, c);
export const clearCard = () => remove(KEY.card);

export const loadProfile = () => read<UserProfile>(KEY.profile);
export const saveProfile = (p: UserProfile) => write(KEY.profile, p);

export function resetAll(): void {
  remove(KEY.session);
  remove(KEY.card);
  remove(KEY.profile);
}
