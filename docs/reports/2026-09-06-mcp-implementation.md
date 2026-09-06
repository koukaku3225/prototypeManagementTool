# ChatGPT・Claude向けMCP連携の実装

日付：2026-09-06
種別：実装
状態：コード実装完了・本番接続設定待ち

## 結論

ChatGPT・Claudeから、このアプリに同期された本人の目標と一週間の行動記録を読み取るMCPを実装した。MCPが提供するのは読み取り専用の2ツールで、AIからユーザーIDやSQLを指定することはできない。

本番のSupabase OAuth・RLS・クライアント登録はまだ設定していない。誤って未監査のDBを公開しないよう、`MCP_ENABLED=true` と必要な環境変数が揃うまでMCPは503で閉じる。

## 依頼と背景

ユーザーがChatGPTやClaudeに「今週の自分を分析して」と依頼すると、このアプリの記録をMCP経由で取得し、AI側で振り返りを作れるようにする依頼だった。

既存アプリはlocalStorageを中心に動き、ログイン中はSupabaseへベストエフォートで同期する。そのためMCPが読めるのはSupabaseへ同期済みの記録だけである。

## 変更内容・調査結果

### 読み取りツール

- `get_goals`：現在の目標、期限、価値観、任意で大きな物語を返す。
- `get_weekly_activity`：指定日からJSTの7日間について、習慣記録と時間割を返す。
- 最大100件でページ分割し、署名付き・15分有効のカーソルで続きを取得する。
- 構造化データと互換用テキストを合わせて64KiB以内になるよう制限する。
- 未記録を未実施へ変換せず、時間割の予定時間を実測時間として扱わない注意書きを返す。
- 目標で絞る習慣記録はDBのリレーションで絞り、件数上限による取りこぼしを避けた。

### 認証と認可

- Supabase OAuth 2.1のBearer JWTをJWKSで検証する。
- issuer、audience、署名、有効期限、発行時刻、subject、許可したclient IDを確認する。
- 未認証は401、許可していないclient IDは403、設定不足は503を返す。
- MCPからDBへ問い合わせる際もユーザーのBearerトークンを使い、全クエリを認証済みuser IDで限定する。
- 認証メタデータを `/.well-known/oauth-protected-resource/api/mcp` で公開する。

### OAuth画面と既存ログイン

- 連携先、共有対象、同期済みデータのみという制約を示す同意画面を追加した。
- Supabase SDKが返した認可情報とログイン中の本人が一致した場合だけ許可・拒否できる。
- 設定画面に、許可中の連携一覧と解除画面への導線を追加した。
- ログイン後に同意画面へ戻れるようにし、戻り先はアプリ内の相対パスだけに制限した。
- OAuth SDKが返す外部リダイレクトはHTTPSに限定し、ローカル開発だけlocalhostのHTTPを許可した。

### 運用上の防御

- MCPは既定で無効。
- JSON-RPC本文と各ツール引数をzodで検証し、最大20件のJSON-RPCバッチに対応する。
- 本文上限、応答上限、ユーザー単位のレート制限、DB問い合わせへの中断signalを追加した。
- 対話全文、過去の挫折、プロフィール、内部計測、外部サービスIDは返さない。

## 仕組みの説明

```mermaid
flowchart LR
  U[ユーザー] --> AI[ChatGPT / Claude]
  AI -->|OAuthログインと同意| AUTH[Supabase Auth]
  AI -->|Bearer JWT + MCP| API[/api/mcp]
  API --> VERIFY[署名・期限・接続先を検証]
  VERIFY --> DB[(Supabase / RLS)]
  DB --> API
  API -->|本人の同期済み記録| AI
  AI -->|週の振り返り| U
```

MCPサーバー自身はAI APIを呼ばない。記録を取得して返し、分析と文章化は接続したChatGPTまたはClaudeが行う。

## 関連ファイル・根拠

- [MCPのHTTP入口](../../src/app/api/mcp/route.ts)
- [MCPツール定義](../../src/lib/mcp/server.ts)
- [DB読み取りと返却形式](../../src/lib/mcp/repository.ts)
- [Bearer JWT検証](../../src/lib/mcp/auth.ts)
- [MCP設定](../../src/lib/mcp/config.ts)
- [OAuth同意画面](../../src/app/oauth/consent/page.tsx)
- [連携一覧・解除画面](../../src/app/settings/connections/page.tsx)
- [セットアップ手順](../mcp-setup.md)
- [環境変数の見本](../mcp-env.example)
- [設計書](../superpowers/specs/2026-09-06-mcp-weekly-review-design.md)
- [実装計画](../superpowers/plans/2026-09-06-mcp-weekly-review.md)

公式資料：[OpenAI MCPサーバー](https://developers.openai.com/plugins/build/mcp-server)、[OpenAI認証](https://developers.openai.com/plugins/build/auth)、[Supabase MCP認証](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)、[Supabase Token Security & RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)

## 確認したこと

### 2026-09-06 最終再検証

- 必須実装ファイルの存在と `git diff --check` を再確認し、欠落・空白エラーはなかった。
- `npm test` を再実行し、既存テストとMCP関連テストがすべて成功した。
- `tsc --noEmit` と `npm run build` を再実行し、型検査・本番ビルドとも成功した。
- 静的確認で、MCP入口の認証先行、全DB問い合わせの `user_id` 制限、読み取り専用アノテーション、64KiB応答制限を確認した。
- `.env.local` は `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` が定義済みだが、MCP用の7項目は未設定だった。秘密値そのものは表示・記録していない。
- したがって、現時点ではMCPが閉じていることが期待される。本物のChatGPT・Claude、Supabase OAuth、実DBを通した接続試験は未実施である。

- MCP用テストを先に失敗させ、実装後に成功することを確認した。
- `npm test`：既存テストとMCP関連5テストがすべて成功。禁止パターンなし（109ファイル走査）。
- `tsc --noEmit`：成功。
- `npm run build`：Next.js 16.3.2の本番ビルド成功。MCP入口、認証メタデータ、同意画面、解除画面がルートとして生成された。
- 公式MCP SDKのクライアントでinitialize、ツール一覧、正常呼び出し、不正引数のエラーを確認した。
- 独立レビューで見つかった、64KiB超過・期限なしJWT・1000習慣超の欠落・JSON-RPCバッチ拒否・403判定の5点を修正した。

ビルドには、上位ディレクトリの別の `package-lock.json` をTurbopackが無視したという既存環境由来の警告が出たが、コンパイル・型検査・ページ生成は成功した。

## 残っていること

コード上の残件はない。本番利用には外部設定が必要で、次の内容は未実施である。

1. Supabase OAuth 2.1 Serverの有効化と認可画面URLの登録。
2. ChatGPT・Claudeのクライアント登録とclient IDの設定。
3. 実DBのRLS・列権限の監査と、MCPトークンによる直接書き込み拒否試験。
4. ステージング環境での実アカウント接続試験。
5. 上記の確認後に `MCP_ENABLED=true` を設定する。

手順は [MCP連携のセットアップ](../mcp-setup.md) にまとめた。本番接続を未確認のまま「ChatGPT・Claudeから利用可能」とは判断していない。
