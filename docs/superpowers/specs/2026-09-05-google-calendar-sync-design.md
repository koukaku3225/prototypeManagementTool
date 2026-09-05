# Googleカレンダー双方向同期 — 設計

作成日: 2026-09-05

## 1. 目的

タイムボックス（時間割）とGoogleカレンダーを双方向に同期する。

- アプリで枠を作る → カレンダーにも入る
- カレンダーで予定を入れる → アプリの時間割にも出る

同期するのは**タイトルと時間だけ**。それ以外（なぜ重要か・障害・対策・振り返り・
できばえ・目標の紐づけ）はアプリ側にしか存在しない。

必須要件: 本人がスムーズに連携できること。ID入力・鍵の貼り付け・カレンダーの
手作成をさせない。ボタン1回と同意1回で終わらせる。

## 2. 決めたこと（要約）

| 論点 | 決定 | 理由 |
|---|---|---|
| 同期の対象 | アプリが作った**専用カレンダーだけ** | 仕事の会議が時間割に流れ込まない。事故の範囲も限定される |
| 反映の早さ | **アプリを開いたとき**＋手動更新 | 定期実行やプッシュ通知の仕組みを増やさない。使うときは必ず開く |
| カレンダーで削除されたら | **振り返り等が空なら消す。何か書いてあれば残す** | 書いたものが黙って消えない |
| Googleの権限 | `calendar.app.created`（**アプリが作ったカレンダーのみ**） | 本来のカレンダーに構造上アクセスできない。漏洩時の被害を最小化 |
| トークンの持ち方 | 自前OAuthで `refresh_token` を取得し、**通常のRLS**で保管 | Supabaseは `provider_token` を更新しないため、ログイン相乗りでは1時間で切れる |
| ログインとの関係 | **切り離す**（自前のOAuth往復） | 既存のログイン処理に触らない。メールリンクの人も連携できる |

### 却下した案

- **ログインのスコープに相乗り（`signInWithOAuth` に scopes を足す）**:
  Supabaseは `provider_token` を自動更新しない。約1時間で切れ、セッション更新で
  消えるため、頻繁に再ログインを強いる。「スムーズ」要件を満たせない。
- **ブラウザから直接Google APIを叩く**: 同じトークン寿命の問題を抱え、
  `client_secret` を使えないため自前更新もできない。

## 3. 権限とトークン

### スコープ

```
https://www.googleapis.com/auth/calendar.app.created
```

公式の説明: 「セカンダリGoogleカレンダーを作成し、そのカレンダー上の予定を
閲覧・作成・変更・削除する」。**アプリが作成したカレンダー以外には触れない。**

### 使う秘密

`GOOGLE_OAUTH_CLIENT_ID` と `GOOGLE_OAUTH_CLIENT_SECRET`。
**どちらも既に `.env.local` にある**（Supabaseに登録した値の控え）。新しい秘密は増えない。

ただし本番のVercelには未設定なので追加が要る。
`scripts/push-env-to-vercel.sh` の `VARS` に2つ足すこと。
`NEXT_PUBLIC_` は絶対に付けない（クライアントに埋め込まれる）。

## 4. データの持ち方

### 新テーブル `google_calendar_links`

| 列 | 型 | 用途 |
|---|---|---|
| `user_id` | uuid PK, FK auth.users | 誰の連携か |
| `refresh_token` | text | Googleのトークン更新用 |
| `calendar_id` | text | 作った専用カレンダーのID |
| `sync_token` | text nullable | 差分取得用。無ければ全件取得 |
| `connected_at` | timestamptz | |
| `last_synced_at` | timestamptz nullable | |
| `last_error` | text nullable | 切り分け用 |

RLSは他の8テーブルと同じ形（`auth.uid() = user_id`、`ALL`）。
`service_role` キーは**導入しない** —— スコープを最小化したことで、
漏洩しても専用カレンダー（＝アプリが既に持っている情報）しか露出しないため。

### `TimeBox` への追加（どちらも任意フィールド）

```ts
googleEventId?: string | null;  // カレンダー側のイベントID
updatedAt?: string;             // ISO8601。「どちらが新しいか」の判断に使う
```

`updatedAt` は `storage.ts` の `upsertTimeBox()` 内で刻む。
タイムボックスへの書き込みが**すべてこの関数を通ることは確認済み**なので、
付け忘れが起きない。

Supabase の `timeboxes` テーブルにも同名の列を足し、
`mappers.ts` の `timeBoxToRow` / `timeBoxFromRow` に対応を足す（AGENTS.mdの規約）。

### カレンダー側の予定に付ける印

作成するイベントに次を入れる。

```
extendedProperties.private.timeboxId = <TimeBoxのid>
```

これにより「アプリで消された予定」と「カレンダーで新規作成された予定」を
区別できる。印が無いと両者が区別できず、削除の墓標テーブルが必要になる。

## 5. 連携の流れ

### 事前作業（1回だけ・手作業）

Google Cloud Console の OAuth クライアントに、リダイレクトURIを2つ追加する。

```
http://localhost:3000/api/calendar/callback
https://prototype-management-tool.vercel.app/api/calendar/callback
```

### `GET /api/calendar/connect`

1. `requireAuthIfEnabled()`（規約どおり先頭で呼ぶ）
2. ランダムな `state` を作り、HttpOnly Cookie に置く（CSRF対策）
3. Googleの認可URLへリダイレクト。要点:
   - `scope=https://www.googleapis.com/auth/calendar.app.created`
   - `access_type=offline` — **`refresh_token` をもらうために必須**
   - `prompt=consent` — 2回目以降も確実に `refresh_token` が返るようにする
   - `state`

### `GET /api/calendar/callback`

1. `state` を Cookie と突き合わせ、違えば拒否
2. `code` をGoogleのトークンエンドポイントへ送り、`refresh_token` を得る
3. 専用カレンダーを作る（`calendars.insert`、`summary: "目標設定コーチ"`）
4. `google_calendar_links` に保存
5. 初回同期を実行し、`/settings?calendar=connected` へリダイレクト

### `POST /api/calendar/sync`

同期の本体。`access_token` は保存せず、**呼ばれるたびに `refresh_token` から取り直す**。

### 解除

`refresh_token` を破棄する。**カレンダー側の予定は消さない**（消すと事故になる）。

## 6. 同期の判断表

### 不変条件（表より優先。どのマスでも破らない）

1. **カレンダーが持つ情報だけをカレンダーから受け取る。**
   取り込みで書き換えてよいのは `title` / `start` / `end` の3つだけ。
   `meta` / `review` / `cardId` / `color` には絶対に触らない。
2. **Supabase同期の向きが決着するまで、カレンダー同期を開始しない。**
   `getSyncState().kind === "ready"` 以外では起動しない。
   まっさらな端末で走ると「全部アプリで消された」と誤判定して
   カレンダーを空にするため。
3. **1回の同期で削除が5件を超えたら、実行せず確認を出す。**

### 表（1件の予定について起こりうる全て）

| # | アプリ側 | カレンダー側 | 印 | 動作 |
|---|---|---|---|---|
| 1 | ある | 無い | — | カレンダーに作成 |
| 2 | ある | ある | あり | 新しい方を採用（title/start/endのみ） |
| 3 | ある | 削除された | あり | `meta`と`review`が空なら削除。何かあれば残す |
| 4 | 無い | ある | あり | アプリで消された → カレンダーからも削除 |
| 5 | 無い | ある | なし | カレンダーで新規作成 → アプリに取り込む |
| 6 | 無い | 削除された | — | 何もしない |
| 7 | 習慣由来（`habit-`）| — | — | 同期しない |

#2 の「新しい方」は `TimeBox.updatedAt` と `event.updated` を比較する。
**同点ならアプリ側を優先**（アプリ側の変更は必ず意図的な操作だが、
カレンダー側の `updated` は他の要因でも動きうるため）。

#7 の理由: 習慣から自動で並ぶ枠は実体を持たず毎回作り直される。
カレンダーに書くと、習慣を変えるたびに「アプリから消えた」と判定されて
削除が走る。v1では見送り、手で作った枠だけを同期する。

### 同期する範囲

過去7日 〜 未来60日。API呼び出し回数と処理時間の上限を決めるため。

### 差分取得

Googleの `syncToken` を使い、2回目以降は変更分だけ取得する。
削除は `status: cancelled` として返る。
`syncToken` が失効（410）したら全件取得にフォールバックする。

## 7. エラー処理

**カレンダー同期は付加機能であり、時間割そのものではない。失敗しても製品を止めない。**

| 事象 | 動作 |
|---|---|
| Googleが落ちている・通信断 | 同期を諦める。時間割は通常どおり動く。「未同期」表示のみ |
| `refresh_token` 失効 | 同期停止 +「再連携してください」。**勝手に作成・削除しない** |
| `syncToken` 失効 | 全件取得へ自動フォールバック |
| 削除5件超 | 実行せず確認を出す |
| 途中で失敗 | 途中まで反映された状態を許容し、次回で追いつく（全か無かにしない） |

`/api/calendar/sync` は例外を投げっぱなしにせず、必ず `{ok:false, message}` を返す。
（レート制限で踏んだ「保険が製品を落とす」穴を繰り返さない）

## 8. テスト

| 対象 | 方法 |
|---|---|
| 判断表の7行 | `decideCalendarAction()` を純粋関数にして総当たり |
| 網羅性 | 表の行数と重複を検査（抜けたマスは誰も試していない） |
| 不変条件1 | 取り込みで `meta`/`review`/`cardId`/`color` が変化しないこと |
| 不変条件3 | 削除6件で止まること |
| 構造 | 同期開始が `syncState === "ready"` の確認を通らずに呼べないことを
`forbidden.test.mjs` で検査。**わざと壊して落ちることを必ず確認する** |

## 9. やらないこと（v1のスコープ外）

- メインカレンダーの読み書き
- プッシュ通知・定期実行による自動同期
- 習慣由来の枠の同期
- 繰り返し予定（RRULE）の解釈 — カレンダー側の繰り返しは、
  展開された個々の予定として取り込む
- 終日予定 — 時間割は時刻を持つ枠なので、取り込み対象外とする
- 複数カレンダーの選択

## 10. 手作業が必要なもの

1. Google Cloud Console にリダイレクトURIを2つ追加（上記）
2. `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` をVercelへ追加
   （`scripts/push-env-to-vercel.sh` の `VARS` に足して実行）
3. OAuth同意画面がテスト中の間は、テストユーザーに本人が入っていること（済）
