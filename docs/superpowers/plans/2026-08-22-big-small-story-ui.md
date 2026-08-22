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

# Stage 2 以降の概要（詳細タスクはStage 1完了後に同粒度で展開）

Stage 1 で土台（型・ストレージ・phase-machine）が固まった時点で、Stage 2〜5 は上記と同じ「Files / Interfaces / bite-sizedステップ」形式に展開してから着手する。ここでは各Stageの範囲とインターフェース契約のみ確定しておく（実行直前に本ファイルへ追記する）。

## Stage 2 — Bigモードの対話

- `src/lib/prompts/phases.ts`: `BIG_PHASE_INSTRUCTIONS: Record<BigPhaseId, string>` 追加、`PHASE_META` を `Record<AnyPhaseId, PhaseMeta>` に拡張
- `src/lib/prompts/extraction.ts`: `BIG_STRUCTURE_EXTRACTION_PROMPT` 追加
- `src/app/api/chat/route.ts`: `ChatRequest.mode` 追加、`PHASE_INSTRUCTIONS`選択をmodeで分岐、`resolvePhase`呼び出しに`mode`を渡す
- `src/app/api/structure/route.ts`: `mode`受け取り、big用に`BigStorySchema`を`Promise.all`へ追加
- `src/app/page.tsx`: モード選択UI、`newSession(picked, mode)`
- `src/app/big/page.tsx`（新規）: BigStory確定画面の骨格（vision/values/currentPosition編集のみ。Small候補はStage3）

**完了条件**: big モードで3〜4ターンの対話が完了し、`/big` で BigStory が確認・編集できる。small モードは無傷で動く。

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
