# Big Story / Small Story + Home再設計・横スライド対話 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Big Story（最大1件）/ Small Story（最大3件）の二層構造を導入し、Homeをハブ＋ジャーナル型に再設計し、対話画面を横スライドのフェーズパネル（編集で後続やり直し）に作り替える。

**Architecture:** 既存の5フェーズ状態機械（`phase-machine.ts`）を `mode: "big" | "small"` に一般化し、`FLOW[mode]` を軸に据える。データはlocalStorage（既存パターン踏襲）に `BigStory` / `SmallStory[]` / `GoalCard[]` として持つ。UIは既存コンポーネントを流用しつつ、Home とSession画面の内部構造のみ作り替える。

**Tech Stack:** Next.js 15 App Router / TypeScript / Tailwind CSS 4 / Anthropic SDK（Haiku 4.5 対話・Sonnet 5 構造化抽出）/ localStorage

**Spec:** `docs/superpowers/specs/2026-08-22-big-small-story-ui-design.md`

## Global Constraints

- Big Story 上限は常に1件、Small Story 上限は常に3件（`status !== "done"` の件数で判定）
- 既存の small 単独モードの動線を退行させない（Big Storyなしで完走できること）
- レガシーデータ（`gc.card` 単数）は `gc.cards` へ一度きり自動移行する
- `PhaseTokenFilter` の正規表現は変更しない（アンダースコア許容済み）
- 各Stageの終わりで `npm test` と `npm run build` が通ること

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/types/goal.ts` | 型定義。`StoryMode`/`BigPhaseId`/`AnyPhaseId`/`BigStory`/`SmallStory`/`PhaseStatus` を追加 |
| `src/lib/storage.ts` | localStorage I/O。BigStory/SmallStory/Cards配列のCRUDとレガシー移行 |
| `src/lib/phase-machine.ts` | mode対応の`nextPhase`/`resolvePhase`、`invalidateFrom`（やり直し版管理） |
| `src/lib/prompts/phases.ts` | `BIG_PHASE_INSTRUCTIONS`、`PHASE_META`のAnyPhaseId拡張 |
| `src/lib/prompts/extraction.ts` | `BIG_STRUCTURE_EXTRACTION_PROMPT`、`SMALL_STORY_PROPOSAL_PROMPT` |
| `src/app/api/chat/route.ts` | mode分岐、Big Story要約の差し込み |
| `src/app/api/structure/route.ts` | BigStory抽出、Small Story提案の並列呼び出し |
| `src/app/page.tsx` | モード選択UI |
| `src/app/big/page.tsx`（新規） | Big Story確定＋Small Story候補確定画面 |
| `src/app/session/page.tsx` | 横スライドフェーズパネル化 |
| `src/app/home/page.tsx` | ハブ（上部）＋ジャーナル（下部） |
| `src/app/card/page.tsx` | `upsertCard`切り替え、SmallStory紐付け |
| `src/lib/export.ts` | Big Storyセクション追加 |
| `tests/phase-machine.test.mjs` | mode対応・`invalidateFrom`のケース追加 |

---

# Stage 1 — 土台（データモデル・ストレージ・phase-machine）

このStageの終わりで、既存の small フローは無傷で動き、新しい型とロジックが単体テストで検証済みの状態にする。UIの見た目はまだ変えない。

### Task 1: 型定義の拡張

**Files:**
- Modify: `src/types/goal.ts`

**Interfaces:**
- Produces: `StoryMode`, `BigPhaseId`, `AnyPhaseId`, `MAX_SMALL_STORIES`, `FLOW`, `BigStory`, `SmallStory`, `PhaseStatus`。`ChatMessage.phase` を `PhaseId` → `AnyPhaseId` に、`ChatMessage.invalidated?: boolean` を追加。`Session.mode`, `Session.phaseStatus` を追加

- [ ] **Step 1: 型を追加する**

`src/types/goal.ts` の `PHASE_TURN_MIN` の直後に追加:

```ts
export type StoryMode = "big" | "small";
export type BigPhaseId = "big_vision" | "big_why" | "big_position";
export type AnyPhaseId = PhaseId | BigPhaseId;

export const MAX_SMALL_STORIES = 3;

export const FLOW: Record<StoryMode, readonly AnyPhaseId[]> = {
  small: PHASE_ORDER,
  big: ["big_vision", "big_why", "big_position"],
};

export const BIG_PHASE_TURN_MIN: Record<BigPhaseId, number> = {
  big_vision: 1,
  big_why: 1,
  big_position: 1,
};

export const BIG_PHASE_TURN_LIMIT: Record<BigPhaseId, number> = {
  big_vision: 2,
  big_why: 3,
  big_position: 2,
};

export type PhaseStatus = "done" | "current" | "upcoming" | "stale";
```

`Obstacle` の直前に追加:

```ts
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
```

`ChatMessage` を書き換え:

```ts
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  phase: AnyPhaseId;
  timestamp: string;
  draftEvents?: DraftEvents;
  invalidated?: boolean;
}
```

`Session` を書き換え（`currentPhase`, `phaseTurnCounts` の型を広げ、`mode`/`phaseStatus` を追加）:

```ts
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
  phaseEnteredAt: Partial<Record<AnyPhaseId, string>>;
}
```

- [ ] **Step 2: ビルドして型エラーを確認する**

Run: `npm run build`
Expected: `src/lib/storage.ts`（`newSession`が`mode`/`phaseStatus`を渡していない）と `src/app/api/chat/route.ts`（`ChatRequest`未対応）などでエラーが出る。これは想定内 — Task 2・Task 5 以降で解消する。ここでは「型定義自体が構文エラーなくコンパイルされる」ことだけを確認する（`tsc --noEmit` の出力に `goal.ts` 自体のエラーが無いこと）

- [ ] **Step 3: コミット**

```bash
git add src/types/goal.ts
git commit -m "feat: BigStory/SmallStory/AnyPhaseIdの型を追加"
```

---

### Task 2: storage.ts の拡張とレガシー移行

**Files:**
- Modify: `src/lib/storage.ts`
- Modify: `src/app/page.tsx:23`（`newSession(picked)` → `newSession(picked, mode)` は Task 9 で対応。ここでは `newSession` のシグネチャ変更のみ行い、呼び出し側は一時的に型エラーのままでよい）

**Interfaces:**
- Consumes: `BigStory`, `SmallStory`, `GoalCard`, `Session`, `MAX_SMALL_STORIES`（Task 1）
- Produces: `loadBigStory(): BigStory | null`, `saveBigStory(b: BigStory): void`, `clearBigStory(): void`, `loadStories(): SmallStory[]`, `saveStories(s: SmallStory[]): void`, `upsertStory(s: SmallStory): void`, `completeStory(id: string): void`, `activeStoryCount(): number`, `loadCards(): GoalCard[]`, `loadCardById(id: string): GoalCard | null`, `upsertCard(c: GoalCard): void`, `newSession(coachId: CoachId, mode: StoryMode): Session`

- [ ] **Step 1: 新しいキーとCRUD関数を追加**

`KEY` オブジェクトに追加:

```ts
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
```

`loadCard`/`saveCard`/`clearCard` の下に追加:

```ts
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
```

- [ ] **Step 2: `loadCard`/`saveCard` をシムに変更**

既存の

```ts
export const loadCard = () => read<GoalCard>(KEY.card);
export const saveCard = (c: GoalCard) => write(KEY.card, c);
export const clearCard = () => remove(KEY.card);
```

を、`loadCards()`（配列）ベースの「最終更新1件を返す」シムに置き換える:

```ts
/** 後方互換シム: 最終更新のカードを1件返す。新規コードは loadCards/upsertCard を使うこと */
export function loadCard(): GoalCard | null {
  const all = loadCards();
  if (all.length === 0) return null;
  return [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** 後方互換シム */
export const saveCard = (c: GoalCard) => upsertCard(c);

export const clearCard = () => remove(KEY.cards);
```

- [ ] **Step 3: `newSession` を mode 対応に**

既存:

```ts
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
```

置き換え:

```ts
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
```

`emptyPhaseCounts()`（`src/types/goal.ts:153`）と `Record<string, number>` の空オブジェクト `{}` は互換なので `emptyPhaseCounts` のexportは残してよいが呼び出しを削除する。

- [ ] **Step 4: `resetAll` に新キーを追加**

```ts
export function resetAll(): void {
  remove(KEY.archive);
  remove(KEY.session);
  remove(KEY.card);
  remove(KEY.cards);
  remove(KEY.bigstory);
  remove(KEY.stories);
  remove(KEY.profile);
}
```

- [ ] **Step 5: 型を確認**

Run: `npm run build`
Expected: `storage.ts` 起因のエラーが消える。呼び出し側（`page.tsx`, `card/page.tsx` 等）はまだ `newSession(coachId)` を1引数で呼んでいるためエラーが残るのは想定内（Stage 2以降で解消）

- [ ] **Step 6: コミット**

```bash
git add src/lib/storage.ts
git commit -m "feat: BigStory/SmallStory/複数カードのストレージ層を追加、レガシー移行を実装"
```

---

### Task 3: phase-machine の mode 対応と invalidateFrom

**Files:**
- Modify: `src/lib/phase-machine.ts`
- Test: `tests/phase-machine.test.mjs`

**Interfaces:**
- Consumes: `StoryMode`, `AnyPhaseId`, `FLOW`, `BIG_PHASE_TURN_MIN`, `BIG_PHASE_TURN_LIMIT`, `PHASE_TURN_MIN`, `PHASE_TURN_LIMIT`, `Session`, `ChatMessage`（Task 1）
- Produces: `nextPhase(mode: StoryMode, current: AnyPhaseId): AnyPhaseId | "done"`, `resolvePhase({mode, current, claimed, turnsInPhase}): {phase: AnyPhaseId | "done"; forced: boolean}`, `invalidateFrom(session: Session, fromPhase: AnyPhaseId): Session`

- [ ] **Step 1: 失敗するテストを書く（`invalidateFrom`）**

`tests/phase-machine.test.mjs` の末尾（`process.exit` の手前）に追加:

```js
// --- mode対応: nextPhase / resolvePhase ---
eq(nextPhase('small', 'diverge'), 'meaning', 'smallモードはPHASE_ORDER通りに進む');
eq(nextPhase('big', 'big_vision'), 'big_why', 'bigモードはFLOW.big通りに進む');
eq(nextPhase('big', 'big_position'), 'done', 'bigモード最終フェーズの次はdone');

eq(
  resolvePhase({ mode: 'big', current: 'big_vision', claimed: 'big_why', turnsInPhase: 1 }),
  { phase: 'big_why', forced: false },
  'bigモードはmin=1で1ターン目から進める',
);
eq(
  resolvePhase({ mode: 'big', current: 'big_why', claimed: 'big_why', turnsInPhase: 3 }),
  { phase: 'big_position', forced: true },
  'bigモードの上限3で強制遷移',
);

// --- invalidateFrom ---
const staleSession = {
  id: 's1',
  mode: 'small',
  coachId: 'kaede',
  currentPhase: 'smart',
  phaseTurnCounts: { diverge: 3, meaning: 3, reframe: 2, smart: 2, woop_wbs: 0 },
  phaseStatus: { diverge: 'done', meaning: 'done', reframe: 'done', smart: 'current', woop_wbs: 'upcoming' },
  messages: [
    { role: 'assistant', content: 'a', phase: 'meaning', timestamp: 't1' },
    { role: 'user', content: 'b', phase: 'smart', timestamp: 't2' },
  ],
  startedAt: 't0',
  completedAt: null,
  variant: { commitmentStep: false, deliberateDelay: false },
  phaseEnteredAt: {},
};
const afterInvalidate = invalidateFrom(staleSession, 'meaning');
eq(afterInvalidate.currentPhase, 'meaning', 'invalidateFromはcurrentPhaseを対象フェーズへ戻す');
eq(afterInvalidate.phaseStatus.reframe, 'stale', '後続フェーズはstaleになる');
eq(afterInvalidate.phaseStatus.smart, 'stale', 'smartもstaleになる');
eq(afterInvalidate.phaseTurnCounts.reframe, 0, '後続フェーズのターン数は0にリセットされる');
eq(afterInvalidate.messages[1].invalidated, true, '対象フェーズ以降のメッセージはinvalidatedになる');
eq(afterInvalidate.messages.length, 2, 'メッセージは削除されず残る');
```

ファイル冒頭の import を更新: `import { PhaseTokenFilter, resolvePhase, nextPhase, invalidateFrom } from '../src/lib/phase-machine.ts';`

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm test`
Expected: FAIL — `nextPhase`/`invalidateFrom` が現行シグネチャと一致せず、または未定義

- [ ] **Step 3: phase-machine.ts を書き換える**

```ts
import {
  FLOW,
  PHASE_TURN_LIMIT,
  PHASE_TURN_MIN,
  BIG_PHASE_TURN_LIMIT,
  BIG_PHASE_TURN_MIN,
  type AnyPhaseId,
  type PhaseStatus,
  type Session,
  type StoryMode,
} from "@/types/goal";

// PhaseTokenFilter, partialTokenTailLength はそのまま変更なし

export function isValidPhase(mode: StoryMode, v: string | null): v is AnyPhaseId {
  return v !== null && (FLOW[mode] as readonly string[]).includes(v);
}

export function nextPhase(mode: StoryMode, current: AnyPhaseId): AnyPhaseId | "done" {
  const order = FLOW[mode];
  const i = order.indexOf(current);
  return i === -1 || i === order.length - 1 ? "done" : order[i + 1];
}

function turnMin(mode: StoryMode, phase: AnyPhaseId): number {
  return mode === "big" ? BIG_PHASE_TURN_MIN[phase as never] : PHASE_TURN_MIN[phase as never];
}
function turnLimit(mode: StoryMode, phase: AnyPhaseId): number {
  return mode === "big" ? BIG_PHASE_TURN_LIMIT[phase as never] : PHASE_TURN_LIMIT[phase as never];
}

export function resolvePhase(args: {
  mode: StoryMode;
  current: AnyPhaseId;
  claimed: string | null;
  turnsInPhase: number;
}): { phase: AnyPhaseId | "done"; forced: boolean } {
  const { mode, current, claimed, turnsInPhase } = args;
  const order = FLOW[mode];

  if (turnsInPhase >= turnLimit(mode, current)) {
    return { phase: nextPhase(mode, current), forced: true };
  }

  const currentIndex = order.indexOf(current);
  const wantsAdvance =
    claimed === "done" ||
    (isValidPhase(mode, claimed) && order.indexOf(claimed as AnyPhaseId) > currentIndex);

  if (wantsAdvance && turnsInPhase >= turnMin(mode, current)) {
    return { phase: nextPhase(mode, current), forced: false };
  }

  return { phase: current, forced: false };
}

/**
 * 過去フェーズの回答が編集されたとき、それより後続のフェーズと
 * メッセージを「やり直し」状態にする。削除はしない（監査ログとして残す）。
 */
export function invalidateFrom(session: Session, fromPhase: AnyPhaseId): Session {
  const order = FLOW[session.mode];
  const fromIndex = order.indexOf(fromPhase);
  if (fromIndex === -1) return session;

  const laterPhases = new Set(order.slice(fromIndex + 1));

  const phaseStatus = { ...session.phaseStatus };
  for (const p of laterPhases) phaseStatus[p] = "stale";
  phaseStatus[fromPhase] = "current";

  const phaseTurnCounts = { ...session.phaseTurnCounts };
  for (const p of laterPhases) phaseTurnCounts[p] = 0;

  const messages = session.messages.map((m) =>
    laterPhases.has(m.phase) ? { ...m, invalidated: true } : m,
  );

  return { ...session, currentPhase: fromPhase, phaseStatus, phaseTurnCounts, messages };
}
```

`nextPhase`/`resolvePhase` の呼び出し箇所（`src/hooks/useConversation.ts`, `src/app/api/chat/route.ts`）は Stage 2 で `mode` 引数を渡すよう更新する（ここではまだ更新しない）。

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `npm test`
Expected: 追加した全ケースが PASS（既存ケースは `mode: 'small'` を渡すよう更新が必要 — 既存の `resolvePhase({current:'meaning',...})` 呼び出し全てに `mode: 'small'` を追加する）

- [ ] **Step 5: コミット**

```bash
git add src/lib/phase-machine.ts tests/phase-machine.test.mjs
git commit -m "feat: phase-machineをmode対応にし、invalidateFromによるやり直し版管理を追加"
```

---

**Stage 1 完了条件:** `npm test` 全件PASS。`npm run build` は Stage 2 で解消される既知のエラー（`newSession`呼び出し側、`ChatRequest`未対応）以外は通ること。

---

# Stage 2 — Bigモードの対話

**スコープのルーリング**: 元の設計仕様には「small モードで Big Story が存在する場合、その要約をシステムプロンプトに差し込む」という項目があるが、これはBig Story側の対話（Task 6-7）とは独立して small モード側にのみ影響する追加機能であり、Stage 2 の完了条件（big モードが動く／small モードが無傷）には不要。Stage 3（Small Story提案でBigStoryを参照する段階）にまとめて実装する方が自然なため、Stage 3 outline 側に追記して Stage 2 からは外す。

**スコープのルーリング2**: `useConversation.ts` の `finalize()` は `phaseTurnCounts`/`phaseEnteredAt` の更新と同じ場所で `phaseStatus` も更新する（フェーズ進行時に前フェーズを`"done"`、新フェーズを`"current"`にする）。これはStage 5専用の新機能ではなく、Task 1で追加された `Session.phaseStatus` フィールドの整合性を最初から保つための最小限の追従。Stage 5はこの状態を消費するだけで、ここで作る必要はあってもここで「使う」必要はない。

### Task 4: BIG_PHASE_INSTRUCTIONS と PHASE_META の拡張

**Files:**
- Modify: `src/lib/prompts/phases.ts`

**Interfaces:**
- Consumes: `AnyPhaseId`, `BigPhaseId`（Task 1, `@/types/goal`）
- Produces: `BIG_PHASE_INSTRUCTIONS: Record<BigPhaseId, string>`。`PHASE_META` の型を `Record<PhaseId, PhaseMeta>` → `Record<AnyPhaseId, PhaseMeta>` に拡張し、big側3件のエントリを追加

- [ ] **Step 1: import を追加**

ファイル冒頭を書き換え:

```ts
import type { AnyPhaseId, BigPhaseId, PhaseId } from "@/types/goal";
```

- [ ] **Step 2: `PHASE_META` の型と中身を拡張**

既存の

```ts
export const PHASE_META: Record<PhaseId, PhaseMeta> = {
```

を

```ts
export const PHASE_META: Record<AnyPhaseId, PhaseMeta> = {
```

に変更し、既存5エントリ（diverge〜woop_wbs）はそのまま残した上で、`woop_wbs` エントリの直後（閉じ `};` の直前）に3エントリを追加:

```ts
  big_vision: {
    id: "big_vision",
    label: "理想像",
    transitionNote: "",
  },
  big_why: {
    id: "big_why",
    label: "なぜそれが大事か",
    transitionNote: "理想の姿が見えてきましたね。次は、なぜそれが大事なのかを聞かせてください。",
  },
  big_position: {
    id: "big_position",
    label: "今の立ち位置",
    transitionNote: "大事にしているものが言葉になってきました。最後に、今の自分がそこからどのあたりにいるかを聞きます。",
  },
```

`PhaseMeta.id` フィールドの型が `PhaseId` 固定なら `AnyPhaseId` に広げる（`interface PhaseMeta { id: AnyPhaseId; ... }`）。

- [ ] **Step 3: `BIG_PHASE_INSTRUCTIONS` を追加**

`PHASE_INSTRUCTIONS` の定義（`woop_wbs` エントリの閉じ `};`）の直後に追加:

```ts
export const BIG_PHASE_INSTRUCTIONS: Record<BigPhaseId, string> = {
  big_vision: `【現在のフェーズ: big_vision（理想像）】

ゴール: 5年後〜10年後、どうなっていたいかを情景として語らせる。

やること:
- 「5年後、あるいは10年後、どうなっていたいですか」を1問だけ聞く
- 情景として語ってもらう。「その時、どんな一日を過ごしていますか」のように具体化を1回だけ促してもよい

やってはいけないこと:
- 数値や期限をこの段階で聞かない
- 複数の質問を一度に投げない
- 評価やアドバイスをしない

次のフェーズへ進む条件:
理想の姿が1つ、情景として語られたら <<<PHASE:big_why>>> を出す。`,

  big_why: `【現在のフェーズ: big_why（なぜそれが大事か）】

ゴール: その理想像がなぜ大事なのかを、価値観として1〜2回掘る。

やること:
- 直前のユーザーの言葉を引用して「なぜそれが大事なんでしょう」と問う
- 価値観を表すキーワードが出たら、それを言い返して確認する

やってはいけないこと:
- 3回以上掘らない（Bigモードは短く済ませる設計）
- 答えを誘導しない

次のフェーズへ進む条件:
「なぜ」への答えが1〜2回分集まったら <<<PHASE:big_position>>> を出す。`,

  big_position: `【現在のフェーズ: big_position（今の立ち位置）】

ゴール: 理想像から見て、今どのあたりにいるかを聞く。フロー体験（今の力量に見合った挑戦）を後で提案するための基準になる。

やること:
- 「いま、その姿から見てどのあたりにいますか」を聞く
- 数値や段階（「3年後は月3万円」等）が自然に出てきたら、それを否定せず受け止める

やってはいけないこと:
- 数値を無理に聞き出そうとしない。出てこなければ状態の言葉のままでよい

次のフェーズへ進む条件:
今の立ち位置が1つ語られたら <<<PHASE:done>>> を出す。`,
};
```

- [ ] **Step 4: ビルドで確認**

Run: `npm run build`
Expected: `phases.ts` 自体に起因するエラーが無いこと（`api/structure/route.ts` が `PHASE_META[m.phase]` を `AnyPhaseId` で引く箇所は元々 `PhaseId` 前提だったが、`Record<AnyPhaseId, PhaseMeta>` への拡張でむしろ型エラーが解消される方向のはず。他ファイルのエラーは無視してよい）

- [ ] **Step 5: コミット**

```bash
git add src/lib/prompts/phases.ts
git commit -m "feat: Bigモード用のフェーズ指示とPHASE_METAの拡張を追加"
```

---

### Task 5: BIG_STRUCTURE_EXTRACTION_PROMPT の追加

**Files:**
- Modify: `src/lib/prompts/extraction.ts`

**Interfaces:**
- Produces: `BIG_STRUCTURE_EXTRACTION_PROMPT: string`

- [ ] **Step 1: プロンプトを追加**

ファイル末尾に追加:

```ts
export const BIG_STRUCTURE_EXTRACTION_PROMPT = `対話ログから Big Story を抽出する。
あなたの役割は記録係であり、創作者ではない。

守ること:
- ユーザーが実際に言った言葉を可能な限りそのまま使う
- ユーザーが言っていないことを補完しない
- 情報が不足している項目は、推測せず null または空配列にする

各項目の取り方:
- vision.raw: ユーザーが最初に語った「理想像」の生の言葉
- vision.refined: 対話を経て本人が言い直した表現。言い直していなければ raw と同じでよい
- values: 「なぜ大事か」への答えに現れた価値観のキーワード。ユーザーが使っていない語を作らない
- currentPosition: 「今の立ち位置」として語られた内容をそのまま使う
- milestones: 数値や段階が語られた場合のみ拾う（例: "3年後: 月3万円"）。無ければ空配列
- horizonYears: 「5年後」「10年後」のように明示されていればその数値。無ければ5

出力は指定されたスキーマに厳密に従う。`;
```

- [ ] **Step 2: ビルドで確認**

Run: `npm run build`
Expected: `extraction.ts` 起因のエラーが無いこと

- [ ] **Step 3: コミット**

```bash
git add src/lib/prompts/extraction.ts
git commit -m "feat: BigStory抽出プロンプトを追加"
```

---

### Task 6: 対話のmodeスレッディング（useConversation.ts / api/chat/route.ts）

**Files:**
- Modify: `src/hooks/useConversation.ts`
- Modify: `src/app/api/chat/route.ts`

**Interfaces:**
- Consumes: `StoryMode`, `AnyPhaseId`, `BigPhaseId`, `PhaseId`（Task 1）、`BIG_PHASE_INSTRUCTIONS`（Task 4）、mode対応済みの `resolvePhase`（Stage 1 Task 3、既に `mode` 引数必須）
- Produces: `/api/chat` が `mode` を受け取り分岐して応答する。`useConversation` の `send`/`finalize` が `AnyPhaseId` ベースで動作し、`mode` をリクエストに含める

このタスクは既存コードに実在する潜在バグの修正を含む: Stage 1 Task 2 で `newSession` の `phaseTurnCounts` が空オブジェクト `{}` になった（旧実装は `emptyPhaseCounts()` で全フェーズ0埋めだった）。そのため `working.phaseTurnCounts[working.currentPhase]` は初回ターンで `undefined` になり、`turnsInPhase: undefined` がサーバーに送られて `undefined + 1 = NaN` になる。`?? 0` で防ぐ。

- [ ] **Step 1: `useConversation.ts` を書き換える**

import 文を書き換え（`PhaseId` → `AnyPhaseId`）:

```ts
import {
  DELAY_PHASES,
  type AnyPhaseId,
  type ChatMessage,
  type DraftEvents,
  type Session,
} from "@/types/goal";
```

`send` 内の fetch body を書き換え:

```ts
        body: JSON.stringify({
          mode: working.mode,
          coachId: working.coachId,
          phase: working.currentPhase,
          turnsInPhase: working.phaseTurnCounts[working.currentPhase] ?? 0,
          messages: working.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          profile: loadProfile(),
          commitmentStep: working.variant.commitmentStep,
        }),
```

`finalize` 関数を丸ごと書き換え:

```ts
/** ストリーム完了時にセッションを確定させる */
function finalize(s: State, working: Session, phase: AnyPhaseId | "done"): State {
  const text = s.streamingText;
  const prevPhase = working.currentPhase;

  const assistantMsg: ChatMessage = {
    role: "assistant",
    content: text,
    phase: prevPhase,
    timestamp: new Date().toISOString(),
  };

  const advanced = phase !== prevPhase;
  const finished = phase === "done";
  const now = new Date().toISOString();

  const session: Session = {
    ...working,
    messages: [...working.messages, assistantMsg],
    currentPhase: finished ? prevPhase : (phase as AnyPhaseId),
    completedAt: finished ? now : null,
    phaseTurnCounts: {
      ...working.phaseTurnCounts,
      [prevPhase]: (working.phaseTurnCounts[prevPhase] ?? 0) + 1,
    },
    phaseStatus:
      advanced && !finished
        ? { ...working.phaseStatus, [prevPhase]: "done", [phase as AnyPhaseId]: "current" }
        : working.phaseStatus,
    phaseEnteredAt:
      advanced && !finished
        ? { ...working.phaseEnteredAt, [phase as AnyPhaseId]: now }
        : working.phaseEnteredAt,
  };

  // 待ち時間ロックは「深さが要る2フェーズで、問いで終わっている」ときだけ
  const nextPhase = session.currentPhase;
  const shouldLock =
    !finished &&
    session.variant.deliberateDelay &&
    (DELAY_PHASES as readonly string[]).includes(nextPhase) &&
    endsWithQuestion(text);

  return {
    ...s,
    session,
    streamingText: "",
    status: finished ? "done" : "idle",
    error: null,
    lockUntil: shouldLock ? Date.now() + LOCK_MS : null,
  };
}
```

`SseHandlers` インターフェースを書き換え:

```ts
interface SseHandlers {
  onDelta: (text: string) => void;
  onDone: (payload: { phase: AnyPhaseId | "done" }) => void;
  onError: (message: string) => void;
}
```

- [ ] **Step 2: `api/chat/route.ts` を書き換える**

import 文を書き換え:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { CHAT_MODEL, getClient, isApiKeyConfigured } from "@/lib/anthropic";
import { COACHES } from "@/lib/prompts/coaches";
import { COACHING_PRINCIPLES } from "@/lib/prompts/principles";
import {
  BIG_PHASE_INSTRUCTIONS,
  CLOSING_INSTRUCTION,
  COMMITMENT_INSTRUCTION,
  PHASE_INSTRUCTIONS,
} from "@/lib/prompts/phases";
import { PhaseTokenFilter, resolvePhase } from "@/lib/phase-machine";
import type { AnyPhaseId, BigPhaseId, CoachId, PhaseId, StoryMode, UserProfile } from "@/types/goal";
```

`ChatRequest` を書き換え:

```ts
interface ChatRequest {
  mode: StoryMode;
  coachId: CoachId;
  phase: AnyPhaseId;
  turnsInPhase: number;
  messages: { role: "user" | "assistant"; content: string }[];
  profile: UserProfile | null;
  /** variant.commitmentStep。最終フェーズの締め方を切り替える（smallモードのみ） */
  commitmentStep: boolean;
}
```

`isFinalTurn` の判定を書き換え:

```ts
  const isFinalTurn =
    body.mode === "small" && body.phase === "woop_wbs" && body.turnsInPhase >= 3;
```

`system` 配列内、`PHASE_INSTRUCTIONS[body.phase]` の行を書き換え:

```ts
      { type: "text", text: instructionsFor(body.mode, body.phase) },
```

`POST` 関数の直前（`function renderProfile` の後、`export async function POST` の前)にヘルパーを追加:

```ts
function instructionsFor(mode: StoryMode, phase: AnyPhaseId): string {
  return mode === "big"
    ? BIG_PHASE_INSTRUCTIONS[phase as BigPhaseId]
    : PHASE_INSTRUCTIONS[phase as PhaseId];
}
```

`resolvePhase` の呼び出しを書き換え:

```ts
        const resolved = resolvePhase({
          mode: body.mode,
          current: body.phase,
          claimed: filter.phase,
          turnsInPhase: body.turnsInPhase + 1,
        });
```

- [ ] **Step 3: ビルドで確認**

Run: `npm run build`
Expected: `useConversation.ts` と `api/chat/route.ts` 自体に起因するエラーが無いこと。`page.tsx`（`newSession` を1引数で呼んでいる）のエラーは Task 8 で解消されるため無視してよい

- [ ] **Step 4: コミット**

```bash
git add src/hooks/useConversation.ts src/app/api/chat/route.ts
git commit -m "feat: /api/chatとuseConversationをmode対応にする"
```

---

### Task 7: api/structure/route.ts の BigStory 抽出対応

**Files:**
- Modify: `src/app/api/structure/route.ts`

**Interfaces:**
- Consumes: `BIG_STRUCTURE_EXTRACTION_PROMPT`（Task 5）、`StoryMode`（Task 1）
- Produces: `POST /api/structure` が `mode: "big"` のとき `{ bigStory: {...}, profile: {...} }` を返す（既存の `mode` 省略／`"small"` 時は従来通り `{ card, profile }` のまま）

- [ ] **Step 1: import と型を追加**

冒頭の import に追加:

```ts
import {
  BIG_STRUCTURE_EXTRACTION_PROMPT,
  PROFILE_EXTRACTION_PROMPT,
  STRUCTURE_EXTRACTION_PROMPT,
} from "@/lib/prompts/extraction";
```

`import type { CoachId, ChatMessage } from "@/types/goal";` を書き換え:

```ts
import type { CoachId, ChatMessage, StoryMode } from "@/types/goal";
```

`ProfileSchema` の直後に追加:

```ts
const BigStorySchema = z.object({
  horizonYears: z.number(),
  vision: z.object({
    raw: z.string(),
    refined: z.string(),
  }),
  values: z.array(z.string()),
  currentPosition: z.string(),
  milestones: z.array(
    z.object({
      label: z.string(),
      state: z.string(),
    }),
  ),
});
```

- [ ] **Step 2: リクエスト型に `mode` を追加**

```ts
  let body: { messages: ChatMessage[]; coachId: CoachId; mode: StoryMode };
```

- [ ] **Step 3: `POST` 内を mode 分岐に書き換える**

`const [cardRes, profileRes] = await Promise.all([...]);` から `return Response.json({...})` までのブロックを、以下に置き換える:

```ts
    if (body.mode === "big") {
      const [bigRes, profileRes] = await Promise.all([
        client.messages.parse({
          model: STRUCTURE_MODEL,
          max_tokens: 2000,
          system: BIG_STRUCTURE_EXTRACTION_PROMPT,
          messages: [{ role: "user", content: transcript }],
          output_config: { format: zodOutputFormat(BigStorySchema) },
        }),
        client.messages.parse({
          model: STRUCTURE_MODEL,
          max_tokens: 2000,
          system: PROFILE_EXTRACTION_PROMPT,
          messages: [{ role: "user", content: transcript }],
          output_config: { format: zodOutputFormat(ProfileSchema) },
        }),
      ]);

      if (!bigRes.parsed_output) {
        return Response.json(
          { error: "parse_failed", message: "対話の整理に失敗しました。" },
          { status: 502 },
        );
      }

      return Response.json({
        bigStory: bigRes.parsed_output,
        profile: profileRes.parsed_output ?? {
          lifePatterns: [],
          pastFailures: [],
          valuesAccumulated: [],
        },
      });
    }

    // 目標カードとプロフィールは別スキーマなので2回に分ける。
    // どちらも1セッションに1回だけなのでコストは小さい。
    const [cardRes, profileRes] = await Promise.all([
      client.messages.parse({
        model: STRUCTURE_MODEL,
        max_tokens: 8000,
        system: STRUCTURE_EXTRACTION_PROMPT,
        messages: [{ role: "user", content: transcript }],
        output_config: { format: zodOutputFormat(GoalCardSchema) },
      }),
      client.messages.parse({
        model: STRUCTURE_MODEL,
        max_tokens: 2000,
        system: PROFILE_EXTRACTION_PROMPT,
        messages: [{ role: "user", content: transcript }],
        output_config: { format: zodOutputFormat(ProfileSchema) },
      }),
    ]);

    if (!cardRes.parsed_output) {
      return Response.json(
        { error: "parse_failed", message: "対話の整理に失敗しました。" },
        { status: 502 },
      );
    }

    return Response.json({
      card: cardRes.parsed_output,
      profile: profileRes.parsed_output ?? {
        lifePatterns: [],
        pastFailures: [],
        valuesAccumulated: [],
      },
    });
```

(このブロックは既存の `try {` の中身。`try`/`catch` 自体はそのまま)

- [ ] **Step 4: ビルドで確認**

Run: `npm run build`
Expected: `api/structure/route.ts` 起因のエラーが無いこと

- [ ] **Step 5: コミット**

```bash
git add src/app/api/structure/route.ts
git commit -m "feat: /api/structureをBigStory抽出に対応させる"
```

---

### Task 8: ランディングのモード選択UI

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `StoryMode`（Task 1）、`newSession(coachId, mode)`（Stage 1 Task 2、既にこのシグネチャ）

- [ ] **Step 1: import と state を追加**

```ts
import { clearSession, loadCard, loadSession, newSession, saveSession } from "@/lib/storage";
import type { CoachId, StoryMode } from "@/types/goal";
```

`const [picked, setPicked] = useState<CoachId>("kaede");` の直後に追加:

```ts
  const [mode, setMode] = useState<StoryMode>("small");
```

- [ ] **Step 2: `start` を mode 対応に**

```ts
  function start() {
    clearSession();
    saveSession(newSession(picked, mode));
    router.push("/session");
  }
```

- [ ] **Step 3: モード選択UIを追加**

`<h2 className="mt-10 text-[13px] font-bold">コーチを選ぶ</h2>` の直前に挿入:

```tsx
      <h2 className="mt-10 text-[13px] font-bold">はじめ方を選ぶ</h2>
      <p className="mt-1 text-[12px] text-muted">
        small：直近の目標を5フェーズで深掘りします。big：5〜10年の大きな物語を言葉にします（3〜4問）。
      </p>
      <div className="mt-3 flex gap-2.5">
        <button
          type="button"
          onClick={() => setMode("small")}
          aria-pressed={mode === "small"}
          className={`flex-1 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            mode === "small"
              ? "border-accent-line bg-accent-soft"
              : "border-line bg-surface"
          }`}
        >
          <span className="text-[14px] font-bold">small目標モード</span>
          <p className="mt-1 text-[11.5px] text-muted">直近の1つを深掘りする</p>
        </button>
        <button
          type="button"
          onClick={() => setMode("big")}
          aria-pressed={mode === "big"}
          className={`flex-1 rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
            mode === "big"
              ? "border-accent-line bg-accent-soft"
              : "border-line bg-surface"
          }`}
        >
          <span className="text-[14px] font-bold">big目標モード</span>
          <p className="mt-1 text-[11.5px] text-muted">5〜10年の物語を言葉にする</p>
        </button>
      </div>
```

- [ ] **Step 4: ビルドで確認**

Run: `npm run build`
Expected: `page.tsx` 起因のエラーが無いこと（これでTask 2由来の `newSession` 1引数呼び出しエラーも解消される）

- [ ] **Step 5: コミット**

```bash
git add src/app/page.tsx
git commit -m "feat: ランディングにbig/small目標モードの選択UIを追加"
```

---

### Task 9: /big/page.tsx（新規）— BigStory確定画面の骨格

**Files:**
- Create: `src/app/big/page.tsx`

**Interfaces:**
- Consumes: `loadSession()`, `archiveSession()`, `loadBigStory()`, `saveBigStory()`（Stage 1 Task 2）、`EditableField`（既存コンポーネント、`src/components/EditableField.tsx`）、`POST /api/structure`（Task 7, `mode: "big"` で `{bigStory, profile}` を返す）
- Produces: `/big` ルート。Small候補の表示・確定はまだ行わない（Stage 3で追加）

`card/page.tsx` には無いが、既存の `session/page.tsx`（確定操作の前に `archiveSession()` してから `clearSession()` する既存パターン）に倣い、Big Storyの元セッションも確定時にアーカイブする。M1〜M4計測の対象から漏れないようにするため。

`src/app/card/page.tsx` の `generate`/`useEffect`/`update` パターン（`loadCard()` → 無ければ `loadSession()` から `/api/structure` を叩いて生成、という流れ）を踏襲する。

- [ ] **Step 1: ファイルを作成**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditableField } from "@/components/EditableField";
import {
  archiveSession,
  clearSession,
  loadBigStory,
  loadSession,
  saveBigStory,
  saveProfile,
} from "@/lib/storage";
import type { BigStory, Session } from "@/types/goal";

type Status = "loading" | "ready" | "error";

export default function BigStoryPage() {
  const router = useRouter();
  const [story, setStory] = useState<BigStory | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const ran = useRef(false);

  const generate = useCallback(async (session: Session, isRetry: boolean) => {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "big",
          messages: session.messages,
          coachId: session.coachId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "整理に失敗しました。");

      const now = new Date().toISOString();
      const built: BigStory = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        coachId: session.coachId,
        horizonYears: data.bigStory.horizonYears,
        vision: data.bigStory.vision,
        values: data.bigStory.values,
        currentPosition: data.bigStory.currentPosition,
        milestones: data.bigStory.milestones,
        editedFields: [],
      };

      saveBigStory(built);
      saveProfile({
        updatedAt: now,
        lifePatterns: data.profile.lifePatterns,
        pastFailures: data.profile.pastFailures,
        valuesAccumulated: data.profile.valuesAccumulated,
        communicationStyle: {
          avgResponseLength: avgUserLength(session),
          prefersConcrete: avgUserLength(session) < 40,
        },
      });
      setStory(built);
      setStatus("ready");
    } catch (err) {
      if (!isRetry) return generate(session, true);
      setError(err instanceof Error ? err.message : "整理に失敗しました。");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const existing = loadBigStory();
    if (existing) {
      setStory(existing);
      setStatus("ready");
      return;
    }
    const session = loadSession();
    if (!session || session.mode !== "big" || session.messages.length === 0) {
      setError("Big Storyの対話が見つかりませんでした。");
      setStatus("error");
      return;
    }
    sessionRef.current = session;
    void generate(session, false);
  }, [generate]);

  function update(path: string, mutate: (b: BigStory) => BigStory) {
    setStory((prev) => {
      if (!prev) return prev;
      const next = mutate(prev);
      next.updatedAt = new Date().toISOString();
      next.editedFields = prev.editedFields.includes(path)
        ? prev.editedFields
        : [...prev.editedFields, path];
      saveBigStory(next);
      return next;
    });
  }

  function confirm() {
    if (sessionRef.current) archiveSession(sessionRef.current);
    clearSession();
    router.push("/home");
  }

  if (status === "loading") {
    return (
      <main className="phone flex flex-1 flex-col items-center justify-center gap-3 px-5">
        <div className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 animate-pulse rounded-full bg-accent"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
        <p className="text-[13px] text-muted">整理しています…</p>
      </main>
    );
  }

  if (status === "error" || !story) {
    return (
      <main className="phone flex flex-1 flex-col items-center justify-center gap-3 px-5">
        <p className="text-[13px] text-muted">{error ?? "読み込めませんでした。"}</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="rounded-xl bg-indigo px-4 py-2.5 text-[13px] text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          トップへ戻る
        </button>
      </main>
    );
  }

  return (
    <main className="phone flex flex-1 flex-col px-5 py-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">
        Big Story
      </p>
      <h1 className="mt-3 font-serif text-[22px] leading-[1.5] font-bold">
        あなたの大きな物語
      </h1>

      <section className="mt-6 flex flex-col gap-5">
        <div>
          <p className="text-[13px] font-bold">理想像</p>
          <div className="mt-1.5">
            <EditableField
              value={story.vision.refined}
              label="理想像"
              multiline
              onSave={(next) =>
                update("vision.refined", (b) => ({
                  ...b,
                  vision: { ...b.vision, refined: next },
                }))
              }
            />
          </div>
        </div>

        <div>
          <p className="text-[13px] font-bold">大事にしているもの</p>
          <div className="mt-1.5">
            <EditableField
              value={story.values.join(" / ")}
              label="大事にしているもの"
              onSave={(next) =>
                update("values", (b) => ({
                  ...b,
                  values: next.split("/").map((v) => v.trim()).filter(Boolean),
                }))
              }
            />
          </div>
        </div>

        <div>
          <p className="text-[13px] font-bold">今の立ち位置</p>
          <div className="mt-1.5">
            <EditableField
              value={story.currentPosition}
              label="今の立ち位置"
              multiline
              onSave={(next) =>
                update("currentPosition", (b) => ({ ...b, currentPosition: next }))
              }
            />
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={confirm}
        className="mt-10 rounded-xl bg-indigo px-4 py-3.5 text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        これで進める
      </button>
    </main>
  );
}

function avgUserLength(session: Session): number {
  const userMsgs = session.messages.filter((m) => m.role === "user");
  if (userMsgs.length === 0) return 0;
  return Math.round(
    userMsgs.reduce((sum, m) => sum + m.content.length, 0) / userMsgs.length,
  );
}
```

- [ ] **Step 2: ビルドで確認**

Run: `npm run build`
Expected: `src/app/big/page.tsx` 起因のエラーが無いこと。この時点で全ファイルのエラーが解消され、ビルドが通ることを確認する（Stage 2の最終タスクのため）

- [ ] **Step 3: コミット**

```bash
git add src/app/big/page.tsx
git commit -m "feat: Big Story確定画面(/big)を追加"
```

---

**Stage 2 完了条件:** `npm run build` がエラーなく通る。`npm test` は Stage 1 分がそのまま通る（Stage 2は型のみのテスト対象がないため新規テスト追加なし）。big モードで3〜4ターンの対話が完了し `/big` で BigStory を確認・編集できる。small モードは無傷で動く。

---

# Stage 3 以降の概要（詳細タスクはStage 2完了後に同粒度で展開）

## Stage 3 — Small Story 3枠

- `src/lib/prompts/extraction.ts`: `SMALL_STORY_PROPOSAL_PROMPT` 追加
- `src/app/api/structure/route.ts`: Small Story提案を`Promise.all`に追加（BigStory抽出＋Small提案＋Profile抽出の3並列）
- `src/app/api/chat/route.ts`: **Stage 2から繰越** — smallモードでBig Storyが存在する場合、その要約をシステムプロンプトに差し込む（`renderProfile()`と同じ形式、cache_control境界の内側）
- `src/app/big/page.tsx`: AI提案のSmall Story候補（最大3件）の表示・編集・確定
- `src/app/card/page.tsx`: `saveCard`→`upsertCard`、対応する`SmallStory.cardId`紐付けと`status`更新
- `src/app/home/page.tsx`: 最小限のBig概要＋3枠表示（ハブ部分の土台。ジャーナルはStage4）
- `src/lib/export.ts`: `toMarkdown`にBig Storyセクション追加

**完了条件**: Small Storyを3件activeにした状態で4件目がブロックされ、1件完了で枠が空く。

## Stage 3 — Small Story 3枠

- `src/lib/prompts/extraction.ts`: `SMALL_STORY_PROPOSAL_PROMPT` 追加
- `src/app/api/structure/route.ts`: Small Story提案を`Promise.all`に追加（BigStory抽出＋Small提案＋Profile抽出の3並列）
- `src/app/big/page.tsx`: AI提案のSmall Story候補（最大3件）の表示・編集・確定
- `src/app/card/page.tsx`: `saveCard`→`upsertCard`、対応する`SmallStory.cardId`紐付けと`status`更新
- `src/app/home/page.tsx`: 最小限のBig概要＋3枠表示（ハブ部分の土台。ジャーナルはStage4）
- `src/lib/export.ts`: `toMarkdown`にBig Storyセクション追加

**完了条件**: Small Storyを3件activeにした状態で4件目がブロックされ、1件完了で枠が空く。

## Stage 4 — Home再設計（ハブ＋ジャーナル）

- `src/app/home/page.tsx`: 上部ハブ（Big概要＋3枠バッジ）と下部ジャーナル（`loadArchive()` + 進行中セッションを時系列マージ、アコーディオン展開）を実装
- 展開したエントリから `/session?resume=<id>&phase=<phaseId>` への編集導線を追加（Stage5の横スライドUIと接続）

**完了条件**: 完了済み・進行中のセッションが時系列で見え、展開してフェーズごとの要約が確認できる。

## Stage 5 — 横スライドフェーズパネル

- `src/components/PhaseProgress.tsx`: ドット表示から、横スライドパネルのナビゲーション（現在位置＋隣接移動）に置き換え
- `src/app/session/page.tsx`: `FLOW[mode]`の各フェーズを1パネルとして描画、`phaseStatus`に応じた4状態のスタイリング、過去パネルの閲覧・編集導線、編集確定時に`invalidateFrom`を呼びストレージへ保存
- 待ち時間ロックのトリガー位置を「現在フェーズパネルに入った直後」に変更（対象フェーズ自体= `DELAY_PHASES` は現行のまま）

**完了条件**: 過去フェーズを編集すると後続が「やり直し」表示になり、該当フェーズに入ると聞き直しの対話が始まる。

---

## 検証（全Stage共通）

1. `npm test` / `npm run build` が最終的に全件通ること
2. レガシー移行: 変更前に small セッションを1本完走して `gc.card` を作り、コード差し替え後に `/home` で失われていないこと
3. small 単独モードが Big Story なしで完走でき、退行がないこと
4. big モードが3〜4ターンで完了し、Small 候補が最大3件出ること
5. Small 3件 active で4件目がブロックされ、完了で枠が空くこと
6. 過去フェーズの編集で後続が stale になり、再度その区間を進められること
7. `/metrics` が既存の M1〜M7 を `loadCard()` シム経由で引き続き算出できること
