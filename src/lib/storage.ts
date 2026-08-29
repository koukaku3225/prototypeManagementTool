"use client";

import {
  emptyPhaseCounts,
  type BigStory,
  type CoachId,
  type ExperimentVariant,
  type GoalCard,
  type Session,
  type StoryMode,
  type TokenUsage,
  type UserProfile,
  FLOW,
  MAX_SMALL_STORIES,
} from "@/types/goal";
import type { Habit, HabitLog } from "@/types/behavior";
import type { TimeBox } from "@/types/timebox";

export const KEY = {
  session: "gc.session",
  card: "gc.card",           // レガシー。移行元としてのみ読む
  cards: "gc.cards",
  bigstory: "gc.bigstory",
  stories: "gc.stories",     // レガシー。SmallStory 廃止で不要。移行で捨てる
  profile: "gc.profile",
  variant: "gc.variant",
  archive: "gc.sessions",
  habits: "gc.habits",
  habitLogs: "gc.habitlogs",
  timeboxes: "gc.timeboxes",
  schemaVersion: "gc.schemaVersion",
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

/**
 * 保存に失敗したことを、アプリ全体へ知らせるための最小の仕組み。
 *
 * write() は以前から false を返していたが、呼び出し側が誰ひとり見ていなかった。
 * 結果、容量超過やプライベートモードでは「操作はできたように見えるのに、
 * 何も保存されていない」という、いちばん質の悪い壊れ方をしていた。
 * 対話の途中でも動き続けられるよう例外は握るが、握ったことは必ず表に出す。
 */
export interface StorageFailure {
  /** 保存できなかったキー */
  key: string;
  at: string;
  /** 容量超過か。プライベートモード等の書き込み禁止と、直し方が違う */
  quota: boolean;
}

let lastFailure: StorageFailure | null = null;
const failureListeners = new Set<(f: StorageFailure | null) => void>();

export function onStorageFailure(
  fn: (f: StorageFailure | null) => void,
): () => void {
  failureListeners.add(fn);
  return () => failureListeners.delete(fn);
}

export const getStorageFailure = (): StorageFailure | null => lastFailure;

function setFailure(f: StorageFailure | null): void {
  lastFailure = f;
  for (const fn of failureListeners) fn(f);
}

/** ユーザーが自分で閉じたとき。次に失敗すればまた出る */
export const dismissStorageFailure = () => setFailure(null);

/**
 * 容量超過かどうか。ブラウザによって name も code も違うので広く拾う。
 * 判定を外しても「保存できなかった」ことは伝わるので、致命的ではない。
 */
function isQuotaError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return (
    err.name === "QuotaExceededError" ||
    err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    err.code === 22 ||
    err.code === 1014
  );
}

/**
 * ローカル保存のたびに呼ばれる。Supabase 同期を有効にしているときだけ
 * sync.ts が自分を登録する。storage.ts はここから先が Supabase かどうかを
 * 知らない（ログインしていない・オフラインなら何も登録されない）。
 */
let onWriteHook: ((key: string, value: unknown) => void) | null = null;
export function setSyncHook(fn: ((key: string, value: unknown) => void) | null): void {
  onWriteHook = fn;
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // 書けたなら以前の失敗は解消している。警告を出しっぱなしにしない
    if (lastFailure) setFailure(null);
    onWriteHook?.(key, value);
    return true;
  } catch (err) {
    setFailure({
      key,
      at: new Date().toISOString(),
      quota: isQuotaError(err),
    });
    return false;
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 保存できなくても対話自体は続行できる */
  }
  // value=null で呼ぶ。「この単一オブジェクトを消した」という意味に使う
  onWriteHook?.(key, null);
}

// ---------------------------------------------------------------- マイグレーション

/**
 * 保存データの形のバージョン。
 *
 * これまで移行は migrateLegacyCard() のような「読むたびに現物を見て直す」
 * 場当たりで、型を変えるたびに同じものを書き足すことになっていた。
 * 版番号を1つ持ち、版から版への関数を並べる形にする。
 *
 * ■ 版を上げるときの手順
 *   1. SCHEMA_VERSION を +1 する
 *   2. MIGRATIONS にその番号の関数を足す（前の版 → その版）
 *   3. tests/storage.test.mjs に、移行前の形を入れて結果を確かめるテストを足す
 *
 * ■ 守ること
 *   - 移行関数は「何度実行しても同じ結果」にする。途中で失敗して再実行されうる
 *   - 消す前に移す。読めなくなったデータは戻らない
 *   - 新しいキーを足したら SNAPSHOT_TARGETS と resetAll() にも足す
 */
export const SCHEMA_VERSION = 2;

/** 版 n への移行。キーは移行後の版番号 */
const MIGRATIONS: Record<number, () => void> = {
  /**
   * v0（版番号を持たない、これまでの全データ）→ v1。
   * これまで散らばっていた場当たりの移行を、ここに集約する。
   */
  1: () => {
    // 単数カード gc.card を配列 gc.cards へ畳む
    const legacy = read<GoalCard>(KEY.card);
    if (legacy) {
      const all = read<GoalCard[]>(KEY.cards) ?? [];
      if (!all.some((c) => c.id === legacy.id)) write(KEY.cards, [...all, legacy]);
      remove(KEY.card);
    }
    // SmallStory は GoalCard.bigStoryId に吸収済み。参照する画面はもう無い
    remove(KEY.stories);
  },

  /**
   * v1 → v2。「次の一歩」（GoalCard.tasks）をタイムボックスへ統合する。
   *
   * やることだけ決めて時間を決めないと、他のことに時間を奪われる。
   * 実際の障害が「ご飯終わり、動画を見た流れで別のことを始めてしまう」
   * という時間帯の奪われ方だったので、予定は必ず時間帯を持つ形に一本化した。
   *
   * 捨てずに移す。時刻が入っていないタスクは 21:00 に仮置きし、
   * 移行したことが分かるようにメモを残す（黙って嘘の時刻にしない）。
   */
  2: () => {
    type LegacyTask = {
      id: string;
      title: string;
      estimateMin: number;
      dueDate: string;
      startTime?: string | null;
      where?: string | null;
      completedAt: string | null;
    };
    type LegacyCard = GoalCard & { tasks?: LegacyTask[] };

    const cards = (read<LegacyCard[]>(KEY.cards) ?? []).slice();
    const boxes = read<TimeBox[]>(KEY.timeboxes) ?? [];
    let moved = 0;

    for (const card of cards) {
      for (const t of card.tasks ?? []) {
        // 同じ移行を2回走らせても増やさない
        if (boxes.some((b) => b.id === `from-task-${t.id}`)) continue;
        const start = t.startTime ?? "21:00";
        const [h, m] = start.split(":").map(Number);
        const startMin = (Number.isFinite(h) ? h : 21) * 60 + (Number.isFinite(m) ? m : 0);
        const endMin = Math.min(1440, startMin + Math.max(15, t.estimateMin || 30));
        const two = (n: number) => String(n).padStart(2, "0");
        boxes.push({
          id: `from-task-${t.id}`,
          date: t.dueDate,
          start: `${two(Math.floor(startMin / 60))}:${two(startMin % 60)}`,
          end: `${two(Math.floor(endMin / 60))}:${two(endMin % 60)}`,
          title: t.title,
          cardId: card.id,
          meta: {
            why: "",
            obstacle: "",
            counter: t.where ? `場所: ${t.where}` : "",
          },
          completedAt: t.completedAt,
          review: null,
          createdAt: card.createdAt,
        });
        if (!t.startTime) {
          // 仮置きしたことを本人が見て分かるようにする
          boxes[boxes.length - 1].meta.why =
            "（旧「次の一歩」から移行。時刻が未設定だったので21時に仮置きしています）";
        }
        moved++;
      }
      delete card.tasks;
    }

    if (moved > 0) write(KEY.timeboxes, boxes);
    write(KEY.cards, cards);
  },
};

/** 現在の版。読めない・未設定なら 0（＝版番号を持たない古いデータ） */
function currentVersion(): number {
  const v = read<number>(KEY.schemaVersion);
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * 1ページ読み込みにつき1回だけ走らせる。
 *
 * レイアウトの useEffect で呼ぶ手も考えたが、React は子の effect を先に走らせる。
 * つまりページ側が先にデータを読んでしまい、移行前の形を掴む。
 * そのため「最初に読む人が引き金を引く」形にしてある。
 */
let migrated = false;

export function ensureMigrated(): void {
  if (migrated) return;
  migrated = true;
  runMigrations();
}

/**
 * テスト専用。別のページ読み込みを模して、移行をもう一度走らせる。
 * 冪等性（何度実行しても同じ結果か）を確かめるのに要る。
 */
export function __resetMigrationFlagForTest(): void {
  migrated = false;
}

/** 実体。スナップショット復元のあとにも呼ぶ */
function runMigrations(): void {
  let v = currentVersion();
  if (v >= SCHEMA_VERSION) return;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[v + 1];
    // 版が飛んでいても止めない。無い版は「変換不要」として通す
    if (step) step();
    v += 1;
    write(KEY.schemaVersion, v);
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

export function loadSession(): Session | null {
  ensureMigrated();
  return read<Session>(KEY.session);
}
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

export function loadBigStory(): BigStory | null {
  ensureMigrated();
  return read<BigStory>(KEY.bigstory);
}
export const saveBigStory = (b: BigStory) => write(KEY.bigstory, b);
export const clearBigStory = () => remove(KEY.bigstory);

/*
 * SmallStory（gc.stories）はここにあったが、どの画面からも呼ばれていなかった。
 * 「Big Story から絞り込んだ候補」という役割は GoalCard.bigStoryId に
 * 吸収済みで、二重に持つ理由がない。型・関数ともに削除した。
 * 既存データに残っている gc.stories は、マイグレーションで捨てる。
 */

// ---------------------------------------------------------------- cards (多目標対応)

export function loadCards(): GoalCard[] {
  ensureMigrated();
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
  // ぶら下がっていた習慣・記録・予定も一緒に消す。残すと孤児になり、
  // 「どの目標のためだったか」が二度と分からなくなる
  deleteHabitsOfCard(id);
  deleteTimeBoxesOfCard(id);
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
    commitment: { accepted: false, acceptedAt: null, userWords: null },
    editedFields: [],
  };
}

export const clearCard = () => remove(KEY.cards);

// ---------------------------------------------------------------- 習慣と実施記録

export function loadHabits(): Habit[] {
  ensureMigrated();
  return read<Habit[]>(KEY.habits) ?? [];
}

/** 畳んでいないものだけ。画面で使うのはたいていこちら */
export const activeHabits = (): Habit[] =>
  loadHabits().filter((h) => !h.archivedAt);

export const habitsOfCard = (cardId: string): Habit[] =>
  activeHabits().filter((h) => h.cardId === cardId);

export function upsertHabit(h: Habit): void {
  const all = loadHabits();
  const i = all.findIndex((x) => x.id === h.id);
  if (i >= 0) all[i] = h;
  else all.push(h);
  write(KEY.habits, all);
}

/**
 * やめる。消さずに畳む。
 * 「続かなかった」も記録で、消すと同じ失敗を繰り返したことに気づけない。
 */
export function archiveHabit(id: string): void {
  const h = loadHabits().find((x) => x.id === id);
  if (!h) return;
  upsertHabit({ ...h, archivedAt: new Date().toISOString() });
}

export function loadHabitLogs(): HabitLog[] {
  ensureMigrated();
  return read<HabitLog[]>(KEY.habitLogs) ?? [];
}

export const logsOfHabit = (habitId: string): HabitLog[] =>
  loadHabitLogs().filter((l) => l.habitId === habitId);

/**
 * その日の記録を書く。
 *
 * 同じ日を押し直したら「行を消す」のではなく「state を書き換える」。
 * チェックを外したら記録ごと消える、という Task 側の壊れ方をここでは繰り返さない。
 * 分母から外したいときは state を "skipped" にする。
 */
export function setHabitLog(log: HabitLog): void {
  const all = loadHabitLogs();
  const i = all.findIndex(
    (l) => l.habitId === log.habitId && l.date === log.date,
  );
  if (i >= 0) all[i] = log;
  else all.push(log);
  write(KEY.habitLogs, all);
}

// ---------------------------------------------------------------- タイムボックス

export function loadTimeBoxes(): TimeBox[] {
  ensureMigrated();
  return read<TimeBox[]>(KEY.timeboxes) ?? [];
}

/** その日ぶんだけ。開始が早い順 */
export const timeBoxesOn = (date: string): TimeBox[] =>
  loadTimeBoxes()
    .filter((b) => b.date === date)
    .sort((a, b) => a.start.localeCompare(b.start));

export const timeBoxesOfCard = (cardId: string): TimeBox[] =>
  loadTimeBoxes().filter((b) => b.cardId === cardId);

export function upsertTimeBox(b: TimeBox): void {
  const all = loadTimeBoxes();
  const i = all.findIndex((x) => x.id === b.id);
  if (i >= 0) all[i] = b;
  else all.push(b);
  write(KEY.timeboxes, all);
}

export function deleteTimeBox(id: string): void {
  write(
    KEY.timeboxes,
    loadTimeBoxes().filter((b) => b.id !== id),
  );
}

/** 目標ごと消えるときは、その目標の枠も消す */
export function deleteTimeBoxesOfCard(cardId: string): void {
  write(
    KEY.timeboxes,
    loadTimeBoxes().filter((b) => b.cardId !== cardId),
  );
}

/** 習慣を畳んでも記録は残す。消すのは目標ごと消えるときだけ */
export function deleteHabitsOfCard(cardId: string): void {
  const habits = loadHabits();
  const gone = new Set(habits.filter((h) => h.cardId === cardId).map((h) => h.id));
  if (gone.size === 0) return;
  write(KEY.habits, habits.filter((h) => h.cardId !== cardId));
  write(KEY.habitLogs, loadHabitLogs().filter((l) => !gone.has(l.habitId)));
}

export function loadProfile(): UserProfile | null {
  ensureMigrated();
  return read<UserProfile>(KEY.profile);
}
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

export function loadArchive(): Session[] {
  ensureMigrated();
  return read<Session[]>(KEY.archive) ?? [];
}

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
  // レガシーキー（card / stories）も消す。残しておくと、次に版を上げたとき
  // 「消したはずのデータが移行で復活する」ことが起きうる
  for (const k of Object.values(KEY)) remove(k);
  migrated = false;
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
  KEY.profile,
  KEY.variant,
  KEY.archive,
  KEY.habits,
  KEY.habitLogs,
  KEY.timeboxes,
  // 版番号も一緒に取る。古いスナップショットを戻したとき、
  // その版から現在の版へ移行をやり直せるようにするため
  KEY.schemaVersion,
] as const;

/** 書き戻しで受け付けるキー。レガシーも含む（移行に通すため） */
const RESTORABLE_KEYS: readonly string[] = Object.values(KEY);

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

/**
 * 取り出した状態を書き戻す。対象キーは一度消してから入れる。
 * 書き戻しに失敗したら黙って諦めない。ここで失敗するのは
 * 「復元したつもりで、実は半分しか戻っていない」という最悪の状態になる。
 */
export function restoreState(data: Record<string, string>): boolean {
  /*
   * 書き戻しの許可リストは、取り出しの対象（SNAPSHOT_TARGETS）より広く取る。
   * 古いスナップショットにはレガシーキー（gc.card など）が入りうるし、
   * それを弾いてしまうと移行の出番が来ないまま黙って消える。
   * 受け取ってから移行に通すほうが、失うものがない。
   */
  for (const k of RESTORABLE_KEYS) remove(k);
  let ok = true;
  for (const [k, v] of Object.entries(data)) {
    if (!RESTORABLE_KEYS.includes(k)) continue;
    try {
      localStorage.setItem(k, v);
      if (lastFailure) setFailure(null);
    } catch (err) {
      ok = false;
      setFailure({ key: k, at: new Date().toISOString(), quota: isQuotaError(err) });
    }
  }
  /*
   * 古いスナップショットには、古い形のデータと古い版番号が入っている。
   * 書き戻した直後に移行をやり直さないと、現在のコードが読めない形のまま
   * 画面に流れ込む。版番号ごと復元してあるので、ここから前に進められる。
   */
  migrated = false;
  ensureMigrated();
  return ok;
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
  return restoreState(snap.data);
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
    return restoreState(Object.fromEntries(entries) as Record<string, string>);
  } catch {
    return false;
  }
}
