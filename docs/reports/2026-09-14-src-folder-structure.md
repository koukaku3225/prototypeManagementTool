# srcフォルダ構成の調査

日付：2026-09-14
種別：調査
状態：完了

## 結論

`src` は131ファイルあり、Next.jsの画面・APIを置く `app`、再利用UIの `components`、Reactフックの `hooks`、業務処理・外部連携の `lib`、共有型の `types` に分かれている。コード変更は行っていない。

## 依頼と背景

現在のアプリで、画面、API、データ処理、外部サービス連携がどこに置かれているか把握できるよう、実際の `src` を走査して構成を整理した。

## 変更内容・調査結果

```text
src/
├─ app/          画面、レイアウト、Route Handler（41ファイル）
│  ├─ api/       chat、structure、calendar、MCP、ローカルバックアップAPI
│  ├─ auth/      Supabaseログイン後のコールバック
│  ├─ oauth/     MCP接続時のOAuth同意画面
│  ├─ settings/  アプリ設定と外部接続管理
│  └─ ...        goals、goal、home、plan、historyなど各画面
├─ components/   複数画面で使うReactコンポーネント（33ファイル）
├─ hooks/        Reactカスタムフック（3ファイル）
├─ lib/          業務ロジック、保存、認証、外部連携（51ファイル）
│  ├─ calendar/  Googleカレンダー連携
│  ├─ mcp/       ChatGPT・Claude向けMCP
│  ├─ prompts/   AIコーチ用プロンプト
│  └─ supabase/  Supabase接続・同期・マッピング
└─ types/        行動、目標、時間割の共有型（3ファイル）
```

### `src/app`

Next.js App Routerの領域。各 `page.tsx` が画面、各 `route.ts` がHTTP APIを表す。ルート直下の `layout.tsx` は全画面共通レイアウト、`loading.tsx`、`error.tsx`、`not-found.tsx` は共通状態表示を担当する。

主なAPIは次のとおり。

- `api/chat`：AIコーチとの対話
- `api/structure`：対話結果の構造化
- `api/calendar`：Googleカレンダーの接続・同期・表示用データ
- `api/mcp`：ChatGPT・Claudeから目標や週間活動を読むMCP入口
- `api/local-backup`：ローカル開発PCへのバックアップ

### `src/components`

画面から再利用するUI部品を置く。ヘッダー・ナビゲーション、チャット入力、習慣チェック、時間割、ヒートマップ、同期状態、バックアップ起動処理などが含まれる。

### `src/hooks`

- `useConversation.ts`：対話状態
- `useGridDrag.ts`：時間割グリッドのドラッグ操作
- `useSupabaseUser.ts`：ログインユーザー状態

### `src/lib`

UIから切り離した処理の中心。日付、ストレージ、習慣、目標カード、時間割、指標、対話フェーズ、API入力検証、認証、レート制限などを置く。外部連携は `calendar`、`mcp`、`supabase` の各サブフォルダへ分離されている。

### `src/types`

複数機能から参照されるTypeScript型を置く。現在は行動記録、目標、時間割の3種類である。

## 仕組みの説明

典型的な処理は、`app` の画面が `components` を組み合わせ、`hooks` で状態を扱い、`lib` の保存・計算・外部連携処理を呼び出す流れになっている。共有するデータ形状は `types` が支える。

## 関連ファイル・根拠

- [`src/app`](../../src/app)：画面とAPI
- [`src/components`](../../src/components)：再利用UI
- [`src/hooks`](../../src/hooks)：Reactフック
- [`src/lib`](../../src/lib)：業務ロジックと外部連携
- [`src/types`](../../src/types)：共有型

## 確認したこと

`rg --files src` とPowerShellのファイル集計で、現在存在する131ファイルと各直下フォルダを確認した。実行時の挙動を調べる依頼ではないため、テストとビルドは実施していない。

## 残っていること

フォルダ構成の把握として残件はない。各画面間の遷移やデータフローまで必要な場合は、別途コードの呼び出し関係を追跡できる。
