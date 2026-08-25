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
  type TokenUsage,
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

/**
 * M8: 進行中セッションにトークン使用量を1件足して、その場で保存する。
 * 画面の state 経由で持ち回すと、確定前に離脱したぶんが計測から落ちる。
 */
export function appendUsage(u: TokenUsage): Session | null {
  const s = loadSession();
  if (!s) return null;
  const next: Session = { ...s, usage: [...(s.usage ?? []), u] };
  saveSession(next);
  return next;
}

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

/** 3枠を消費しているカード。done は数えない */
export const activeCards = (): GoalCard[] =>
  loadCards().filter((c) => (c.status ?? "active") !== "done");

export const canAddGoal = (): boolean => activeCards().length < MAX_SMALL_STORIES;

export function setCardStatus(id: string, status: "active" | "done"): void {
  const c = loadCardById(id);
  if (!c) return;
  upsertCard({ ...c, status, updatedAt: new Date().toISOString() });
}

export function deleteCard(id: string): void {
  write(
    KEY.cards,
    loadCards().filter((c) => c.id !== id),
  );
}

/** 空のカード。手入力で最初から埋めるときの土台にする */
export function emptyCard(coachId: CoachId, bigStoryId: string | null): GoalCard {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    coachId,
    bigStoryId,
    rationale: "",
    status: "active",
    source: "manual",
    vision: { raw: "", refined: "" },
    meaning: {
      whyChain: [],
      values: [],
      motivationType: "internal",
      reframed: null,
      reframedFrom: null,
    },
    smart: {
      specific: "",
      measurable: "",
      metricUnit: null,
      metricTarget: null,
      deadline: "",
      achievableNote: "",
    },
    woop: { wish: "", outcome: "", obstacles: [] },
    tasks: [],
    commitment: { accepted: false, acceptedAt: null, userWords: null },
    editedFields: [],
  };
}

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
  const i = all.findIndex((x) => x.id === s.id);
  // 続きから話した対話は同じIDで戻ってくる。増やさず、伸びた分で置き換える
  if (i >= 0) all[i] = s;
  else all.push(s);
  write(KEY.archive, all);
}

export const loadArchive = (): Session[] => read<Session[]>(KEY.archive) ?? [];

/** 保存済みの対話を1件引く。進行中のセッションも探す */
export function loadArchivedSession(id: string): Session | null {
  // 進行中のものを優先する。続きから話している最中は、そちらが最新
  const current = loadSession();
  if (current?.id === id) return current;
  return loadArchive().find((s) => s.id === id) ?? null;
}

/**
 * 過去の対話を現役に戻して、続きから話せるようにする。
 *
 * 終わった対話でも、あとから「もう少し話したい」ことがある。
 * 同じセッションIDのまま戻すので、完成したときは元の成果物を
 * 上書きする（新しく増やさない）。
 *
 * 現在のフェーズのターン数は 0 に戻す。上限に達したまま復帰すると
 * 一言も話せずに「完了」へ押し戻されてしまうため。
 */
export function resumeArchivedSession(id: string): Session | null {
  const src = loadArchivedSession(id);
  if (!src) return null;

  const resumed: Session = {
    ...src,
    completedAt: null,
    phaseTurnCounts: { ...src.phaseTurnCounts, [src.currentPhase]: 0 },
    phaseStatus: { ...src.phaseStatus, [src.currentPhase]: "current" },
    resumedAt: new Date().toISOString(),
  };
  saveSession(resumed);
  return resumed;
}

/** この対話から生まれた成果物があるか。続きを話すときの上書き先になる */
export function outcomeOfSession(sessionId: string): {
  card: GoalCard | null;
  big: BigStory | null;
} {
  const big = loadBigStory();
  return {
    card: loadCards().find((c) => c.sessionId === sessionId) ?? null,
    big: big?.sessionId === sessionId ? big : null,
  };
}

export function resetAll(): void {
  remove(KEY.archive);
  remove(KEY.session);
  remove(KEY.card);
  remove(KEY.cards);
  remove(KEY.bigstory);
  remove(KEY.stories);
  remove(KEY.profile);
}

// ---------------------------------------------------------------- スナップショット

/**
 * 開発中に毎回ゼロから対話をやり直すのは手間もAPIコストもかかる。
 * いまの状態に名前を付けて保存し、ワンクリックで戻せるようにする。
 * スナップショット自体は保存対象に含めない（入れ子になるため）。
 */
const SNAPSHOT_TARGETS = [
  KEY.session,
  KEY.cards,
  KEY.bigstory,
  KEY.stories,
  KEY.profile,
  KEY.variant,
  KEY.archive,
] as const;

export interface Snapshot {
  id: string;
  name: string;
  createdAt: string;
  data: Record<string, string>;
}

const SNAPSHOT_KEY = "gc.snapshots";

/** いまの状態を丸ごと取り出す。JSON書き出しにも使う */
export function captureState(): Record<string, string> {
  const data: Record<string, string> = {};
  for (const k of SNAPSHOT_TARGETS) {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) data[k] = v;
    } catch {
      /* 読めないキーは飛ばす */
    }
  }
  return data;
}

/** 取り出した状態を書き戻す。対象キーは一度消してから入れる */
export function restoreState(data: Record<string, string>): void {
  for (const k of SNAPSHOT_TARGETS) remove(k);
  for (const [k, v] of Object.entries(data)) {
    if (!(SNAPSHOT_TARGETS as readonly string[]).includes(k)) continue;
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 容量超過なら諦める */
    }
  }
}

export const listSnapshots = (): Snapshot[] =>
  read<Snapshot[]>(SNAPSHOT_KEY) ?? [];

export function saveSnapshot(name: string): Snapshot {
  const snap: Snapshot = {
    id: crypto.randomUUID(),
    name: name.trim() || new Date().toLocaleString("ja-JP"),
    createdAt: new Date().toISOString(),
    data: captureState(),
  };
  write(SNAPSHOT_KEY, [...listSnapshots(), snap]);
  return snap;
}

export function applySnapshot(id: string): boolean {
  const snap = listSnapshots().find((s) => s.id === id);
  if (!snap) return false;
  restoreState(snap.data);
  return true;
}

export function deleteSnapshot(id: string): void {
  write(
    SNAPSHOT_KEY,
    listSnapshots().filter((s) => s.id !== id),
  );
}

/** JSON文字列から復元する。形が違えば false を返して何も壊さない */
export function importStateJson(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (!entries.every(([, v]) => typeof v === "string")) return false;
    restoreState(Object.fromEntries(entries) as Record<string, string>);
    return true;
  } catch {
    return false;
  }
}
