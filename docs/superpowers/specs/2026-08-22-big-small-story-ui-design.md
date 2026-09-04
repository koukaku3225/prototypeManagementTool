# Big Story / Small Story 二層構造 ＋ Home再設計・横スライド対話 — 設計仕様

## Context

現状のMVPは「1セッション＝1目標」で完結しており、`GoalCard`（`src/types/goal.ts:59`）は親子関係を持たない完全にフラットな構造。`storage.ts` も `gc.card` に単一のカードしか保存できない。5フェーズ対話（diverge→meaning→reframe→smart→woop_wbs）は縦一列のチャットとして表示され、過去のフェーズの回答を見返す・編集する手段がない。

本仕様は3つの課題をまとめて解決する:

1. **長期ビジョンと直近の目標を区別できない** → Big Story（最大1件）/ Small Story（最大3件）の二層構造を導入する
2. **UIが均質で温かみがなく、複数のSmall Storyを並行運用する状態を表現できない** → Homeを「ハブ（今の状態）＋ジャーナル（積み重ねた記録）」の合体構成に再設計する
3. **過去の回答を振り返る・訂正する手段がない** → 対話画面を横スライドのフェーズパネル構造にし、編集で後続フェーズが「やり直し」になる仕組みを入れる

この3つは互いに依存する（②③は①のデータモデルの上に成立する）ため1つの仕様として書くが、実装計画は独立してテスト可能な段階に分割する。

配色・タイポグラフィの方向性（柿色を主役に、藍をフェーズ2・3限定のアクセントに）は別途モックアップで承認済み。本仕様はその上に構造を積む。

---

## 決定事項（ユーザー確認済み）

| 項目 | 決定 |
|---|---|
| Big Story 上限 | 1件 |
| Small Story 上限 | 3件（上限。ユーザーが編集可能） |
| モード選択 | ランディングで big目標モード / small目標モード を選択 |
| Small の独立性 | Big Story なしでも small 単独で使える（既存MVPの使い方を維持） |
| 紐づけ | small 作成時に Big Story へ紐づけ可能（必須ではない） |
| Big の生成方法 | AIが提案 → ユーザーが確定・編集 |
| Big の対話フロー | 専用の短いフロー（3〜4ターン）。既存5フェーズは使わない |
| Small の提案基準 | ユーザーの価値観と「フロー体験」（力量に見合った挑戦度）に合うもの |
| 3枠が埋まったら | 完了したら自動で枠が空く（done は枠を消費しない） |
| Home の構成 | 上部＝ハブ（Big Story要約＋Small 3枠）、下部＝ジャーナル（時系列、進行中も含む） |
| 対話画面の構造 | 横スライドのフェーズパネル。左スワイプで過去フェーズを閲覧・編集 |
| 過去編集の扱い | 編集すると後続フェーズが「やり直し」になる。旧メッセージは削除せず `invalidated` フラグで保持 |

---

## データモデル

`src/types/goal.ts` に追加。既存の `GoalCard` / `Session` / `UserProfile` は破壊しない。

```ts
export type StoryMode = "big" | "small";

/** Bigモード専用フェーズ。3ターンで理想像・価値観・現在地を取る */
export type BigPhaseId = "big_vision" | "big_why" | "big_position";
export type AnyPhaseId = PhaseId | BigPhaseId;

export const MAX_SMALL_STORIES = 3;

export const FLOW: Record<StoryMode, readonly AnyPhaseId[]> = {
  small: PHASE_ORDER,
  big: ["big_vision", "big_why", "big_position"],
};

export interface BigStory {
  id: string;
  createdAt: string;
  updatedAt: string;
  coachId: CoachId;
  horizonYears: number;            // 5 or 10
  vision: { raw: string; refined: string };
  values: string[];                // フロー判定と Small 提案の根拠
  currentPosition: string;         // 現在地。挑戦度の較正に必須
  milestones: { label: string; state: string }[]; // 「3年後: 月3万円」等。空可
  editedFields: string[];          // M5 と同じ精度計測の枠組みを流用
}

export interface SmallStory {
  id: string;
  bigStoryId: string | null;       // small単独モードなら null
  title: string;
  rationale: string;               // なぜ Big Story / 価値観に効くか
  flowNote: string;                // 今の力量との噛み合い（フローの根拠）
  status: "proposed" | "active" | "done";
  cardId: string | null;           // 5フェーズ対話で深掘り済みなら GoalCard.id
  createdAt: string;
  completedAt: string | null;
}
```

`Session` / `ChatMessage` の拡張（振り返り編集のための版管理を追加）:

```ts
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  phase: AnyPhaseId;               // PhaseId から拡張
  timestamp: string;
  draftEvents?: DraftEvents;
  invalidated?: boolean;           // 後続フェーズの編集により無効化された発言。削除せず残す
}

export type PhaseStatus = "done" | "current" | "upcoming" | "stale";

export interface Session {
  id: string;
  mode: StoryMode;                          // 既定 "small"。未設定の旧データは small 扱い
  coachId: CoachId;
  currentPhase: AnyPhaseId;
  phaseTurnCounts: Record<string, number>;
  phaseStatus: Partial<Record<AnyPhaseId, PhaseStatus>>; // 横スライドパネルの表示状態
  messages: ChatMessage[];
  startedAt: string;
  completedAt: string | null;
  variant: ExperimentVariant;
  phaseEnteredAt: Partial<Record<AnyPhaseId, string>>;
}
```

**枠の数え方**: `status !== "done"` の SmallStory が3件で上限。完了すると自動的に枠が空く（別途アーカイブ操作は不要）。

**やり直しの実体**: フェーズ N を編集して確定すると、フェーズ N+1 以降について
1. `phaseStatus[phase] = "stale"` にする
2. その区間に属する `ChatMessage` は削除せず `invalidated = true` を立てる
3. `phaseTurnCounts[phase]` を0にリセットする
4. `currentPhase` をフェーズ N に戻す（次にNを抜けるとき、通常の遷移でN+1が新規に開始される）

GoalCard／BigStoryのフィールドがやり直しで古くなった場合は、既存の `editedFields`（M5計測用）と同じ配列に `stale:` プレフィックス付きで積む簡易実装とする。専用の版管理テーブルは作らない（YAGNI）。

---

## ストレージ

`src/lib/storage.ts` に追加。既存の `read`/`write`/`remove` ヘルパをそのまま使う。

- `gc.bigstory` — `BigStory | null`（1件のみ）
- `gc.stories` — `SmallStory[]`
- `gc.cards` — `GoalCard[]`（現在の単数 `gc.card` から移行）

新規関数：
- `loadBigStory()` / `saveBigStory()` / `clearBigStory()`
- `loadStories()` / `saveStories()` / `upsertStory()` / `completeStory(id)`
- `activeStoryCount()` — `status !== "done"` の件数。上限判定に使う
- `loadCards()` / `loadCardById(id)` / `upsertCard(c)`
- `invalidateFrom(session, phase)` — 上記「やり直しの実体」の4手順を実行し、更新後の `Session` を返す純粋関数（`storage.ts` ではなく `phase-machine.ts` に置く。ストレージへの保存は呼び出し側が行う）

**後方互換**: `loadCards()` の初回呼び出し時に、レガシーな `gc.card` が存在すれば `gc.cards` へ畳み込む一度きりの移行を行う。既存の `loadCard()` は「最終更新のカードを返す」シムとして残し、`src/app/page.tsx:18` と `src/app/metrics/page.tsx:24` は無改修で動くようにする。`resetAll()`（`storage.ts:107`）に新キー3つを追加。

---

## フェーズ機械の一般化

`src/lib/phase-machine.ts` を mode 対応にする。`PhaseTokenFilter` の正規表現 `/<<<PHASE:([a-z_]+)>>>/`（`phase-machine.ts:8`）は既にアンダースコアを許容するため変更不要。

- `nextPhase(mode, current)` — `FLOW[mode]` を参照するよう引数追加
- `resolvePhase({ mode, current, claimed, turnsInPhase })` — 同上
- `invalidateFrom(session, fromPhase)` — 上記の版管理ロジック
- `PHASE_TURN_MIN` / `PHASE_TURN_LIMIT` に big フェーズを追加：

| フェーズ | min | limit |
|---|---|---|
| `big_vision` | 1 | 2 |
| `big_why` | 1 | 3 |
| `big_position` | 1 | 2 |

`tests/phase-machine.test.mjs` に big モードのケースと `invalidateFrom` のケースを追加。

---

## プロンプト

### `src/lib/prompts/phases.ts`
`BIG_PHASE_INSTRUCTIONS: Record<BigPhaseId, string>` を追加。既存の `PHASE_INSTRUCTIONS` と同じ書式。

- **big_vision**: 「5年後〜10年後、どうなっていたいですか」を1問だけ。情景で語らせる
- **big_why**: 直前の言葉を引用して「なぜそれが大事か」を1〜2回
- **big_position**: 「いま、その姿からどのあたりにいますか」。フロー較正のための現在地を取る

`PHASE_META` を `Record<AnyPhaseId, PhaseMeta>` に拡張。

### `src/lib/prompts/extraction.ts`
- `BIG_STRUCTURE_EXTRACTION_PROMPT` — 対話ログから `BigStory` を抽出
- `SMALL_STORY_PROPOSAL_PROMPT` — 最大3件のSmall Story候補を提案（唯一「創作」を許すプロンプト。ただし根拠を明示）:

```
入力: BigStory（vision / values / currentPosition / milestones）＋ UserProfile
出力: 最大3件の Small Story 候補

較正の規則:
- currentPosition より「わずかに上」の挑戦度にする
- 3ヶ月以内に手応えが確認できる粒度にする
- UserProfile.pastFailures にある失敗パターンを踏ませない
- values に含まれる言葉と接続し、rationale にその接続を1文で書く
- flowNote には「なぜ今のこの人にとって噛み合うか」を1文で書く
- 3件は互いに重複させない
```

---

## API

### `src/app/api/chat/route.ts`
- `ChatRequest` に `mode: StoryMode` を追加
- `PHASE_INSTRUCTIONS[phase]` の選択を mode で分岐
- `isFinalTurn` の判定を mode 別に。big モードでは `COMMITMENT_INSTRUCTION`/`CLOSING_INSTRUCTION` は使わない
- small モードで Big Story が存在する場合、`renderProfile()` と同じ形式で Big Story の要約をシステムプロンプトに差し込む（既存のプロンプトキャッシュ境界の内側）

### `src/app/api/structure/route.ts`
- `mode` を受け取り分岐。small モードは既存の `GoalCardSchema` + `ProfileSchema` の2並列のまま
- big モード用に `BigStorySchema` と `SmallStoryProposalSchema` を追加し、`Promise.all` で2並列

---

## 画面設計

### Home（`src/app/home/page.tsx`）— ハブ＋ジャーナル

**上部固定ゾーン（ハブ）**:
- Big Story要約カード（vision抜粋・milestones）。未作成なら「大きな物語を始める」への控えめな導線のみ
- Small Story 3枠のカード（進行中／空き／AI提案待ち、をバッジで区別）。タップでその対話・確認画面に遷移

**下部スクロールゾーン（ジャーナル）**:
- 時系列リスト（新しい順）。完了済みだけでなく進行中セッションも「進行中」バッジ付きで出現
- 各エントリはアコーディオンで展開すると、フェーズパネルの縮小プレビュー（各フェーズの一言要約）が見える。そこから編集導線（`/session?resume=<id>&phase=<phaseId>`）に入れる

Big Story／Small単体だけの人には上部ハブのBig Storyカードを出さず、「大きな物語を始める」の1行だけに留める（既存のMVP動線を壊さない）。

### セッション画面（`src/app/session/page.tsx`）— 横スライドフェーズパネル

- `FLOW[mode]` の各フェーズを1パネルとして横に並べる。現在フェーズが全幅表示、左右のフリック/矢印ボタンで隣接パネルに移動
- パネルの表示状態は4種（`PhaseStatus`）: `done`(完了・緑) / `current`(現在・柿色) / `upcoming`(未着手・グレー) / `stale`(やり直し対象・赤破線)
- 過去パネル（`done`）を開くと閲覧専用で表示され、「この回答を編集する」ボタンがある
- 編集して確定すると `invalidateFrom(session, phase)` を呼び、それより後続のパネルが `stale` になる。ユーザーがそのパネルに入ると「この回答の変更で、ここから先は聞き直します」の案内とともに `/api/chat` を再度叩いて対話を再開する
- 待ち時間ロック（既存60秒）は「現在フェーズパネルに入った直後」に発生させる形にトリガー位置を変更する（対象フェーズの条件自体は現行の `DELAY_PHASES` のまま据え置き、今回はトリガー位置の変更のみ）

### `src/app/big/page.tsx`（新規）
Big Story確定画面。`EditableField` を使い回して vision / values / currentPosition を編集可能に。下部にAI提案のSmall Story候補（最大3件）を出し、編集・取捨選択して確定する。

### `src/app/card/page.tsx`
`saveCard` → `upsertCard` に差し替え。対応する `SmallStory.cardId` を紐づけ、`status` を `"active"` に更新。

### `src/lib/export.ts`
`toMarkdown` に Big Story セクションを追加。

---

## 自己レビュー（brainstormingスキルの仕様セルフレビュー）

- **プレースホルダ確認**: 「TBD」「後で決める」等は無し
- **内部整合性**: `ChatMessage.phase` の型を `PhaseId` から `AnyPhaseId` に広げたことで `PHASE_META`（big拡張前提）・`renderTranscript()`（既存, `PHASE_META[m.phase].label` を引く）との整合を確認済み。矛盾なし
- **スコープ**: 3つの課題（データモデル／Home再設計／横スライド対話）は依存関係がある一直線の積み上げであり、1つの実装計画の中で段階分割すれば十分。無理に独立仕様に分ける必要はないと判断
- **曖昧箇所**: 「やり直し」時にBigStory/GoalCardのどのフィールドをstale扱いにするかは、対象フェーズ以降で抽出される全フィールドを対象とする、と明示済み（上記データモデル節）
