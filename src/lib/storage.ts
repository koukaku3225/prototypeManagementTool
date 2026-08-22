"use client";

import {
  emptyPhaseCounts,
  type BigStory,
  type CoachId,
  type ExperimentVariant,
  type GoalCard,
  type Session,
  type SmallStory,
  type StoryMode,
  type UserProfile,
  FLOW,
  MAX_SMALL_STORIES,
} from "@/types/goal";

const KEY = {
  session: "gc.session",
  card: "gc.card",           // レガシー。移行元としてのみ読む
  cards: "gc.cards",
  bigstory: "gc.bigstory",
  stories: "gc.stories",
  profile: "gc.profile",
  variant: "gc.variant",
  archive: "gc.sessions",
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

export function newSession(coachId: CoachId, mode: StoryMode): Session {
  const now = new Date().toISOString();
  const firstPhase = FLOW[mode][0];
  return {
    id: crypto.randomUUID(),
    mode,
    coachId,
    currentPhase: firstPhase,
    phaseTurnCounts: {},
    phaseStatus: { [firstPhase]: "current" },
    messages: [],
    startedAt: now,
    completedAt: null,
    variant: getVariant(),
    phaseEnteredAt: { [firstPhase]: now },
  };
}

export const loadSession = () => read<Session>(KEY.session);
export const saveSession = (s: Session) => write(KEY.session, s);
export const clearSession = () => remove(KEY.session);

// ---------------------------------------------------------------- big story

export const loadBigStory = () => read<BigStory>(KEY.bigstory);
export const saveBigStory = (b: BigStory) => write(KEY.bigstory, b);
export const clearBigStory = () => remove(KEY.bigstory);

// ---------------------------------------------------------------- small stories

export const loadStories = (): SmallStory[] => read<SmallStory[]>(KEY.stories) ?? [];
export const saveStories = (s: SmallStory[]) => write(KEY.stories, s);

export function upsertStory(s: SmallStory): void {
  const all = loadStories();
  const i = all.findIndex((x) => x.id === s.id);
  if (i >= 0) all[i] = s;
  else all.push(s);
  saveStories(all);
}

export function completeStory(id: string): void {
  const all = loadStories();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) return;
  all[i] = { ...all[i], status: "done", completedAt: new Date().toISOString() };
  saveStories(all);
}

export const activeStoryCount = (): number =>
  loadStories().filter((s) => s.status !== "done").length;

// ---------------------------------------------------------------- cards (多目標対応)

/** レガシーな単数カードを配列へ一度だけ畳み込む */
function migrateLegacyCard(): void {
  const legacy = read<GoalCard>(KEY.card);
  if (!legacy) return;
  const all = read<GoalCard[]>(KEY.cards) ?? [];
  if (!all.some((c) => c.id === legacy.id)) {
    write(KEY.cards, [...all, legacy]);
  }
  remove(KEY.card);
}

export function loadCards(): GoalCard[] {
  migrateLegacyCard();
  return read<GoalCard[]>(KEY.cards) ?? [];
}

export const loadCardById = (id: string): GoalCard | null =>
  loadCards().find((c) => c.id === id) ?? null;

export function upsertCard(c: GoalCard): void {
  const all = loadCards();
  const i = all.findIndex((x) => x.id === c.id);
  if (i >= 0) all[i] = c;
  else all.push(c);
  write(KEY.cards, all);
}

/** 後方互換シム: 最終更新のカードを1件返す。新規コードは loadCards/upsertCard を使うこと */
export function loadCard(): GoalCard | null {
  const all = loadCards();
  if (all.length === 0) return null;
  return [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** 後方互換シム */
export const saveCard = (c: GoalCard) => upsertCard(c);

export const clearCard = () => remove(KEY.cards);

export const loadProfile = () => read<UserProfile>(KEY.profile);
export const saveProfile = (p: UserProfile) => write(KEY.profile, p);

/**
 * 完了したセッションを計測用に退避する。
 * 確定時に gc.session を消すと draftEvents やフェーズ滞在時間が失われ、
 * M1〜M4 が判定できなくなるため。
 */
export function archiveSession(s: Session): void {
  const all = read<Session[]>(KEY.archive) ?? [];
  if (all.some((x) => x.id === s.id)) return;
  write(KEY.archive, [...all, s]);
}

export const loadArchive = (): Session[] => read<Session[]>(KEY.archive) ?? [];

export function resetAll(): void {
  remove(KEY.archive);
  remove(KEY.session);
  remove(KEY.card);
  remove(KEY.cards);
  remove(KEY.bigstory);
  remove(KEY.stories);
  remove(KEY.profile);
}
