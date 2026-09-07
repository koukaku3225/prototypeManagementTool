# MCP weekly review implementation plan

Goal: 認証付きの読み取りMCPと同意・解除画面を実装する。
Architecture: Next.jsのWeb標準HTTP入口、公式MCP SDK、Supabase OAuthとユーザー権限DB取得。
Spec: [設計書](../specs/2026-09-06-mcp-weekly-review-design.md)

## Constraints and rulings

- JSTの7日間、未記録と失敗を区別、現在の目標、100件・64KiBの上限。
- 実環境の権限が未監査なのでMCP_ENABLEDは既定無効。セットアップ文書に実環境検証を残す。
- 現在の作業ディレクトリに既存の未コミット文書があるため保持して作業する。コミット・デプロイは行わない。
- Supabaseの認証とRLSを弱めて接続を成立させない。公開には環境設定とDB監査が必要。

## Tasks

- [x] 1. 入力・データ整形・ページング：`api-schema.ts`と`lib/mcp/data.ts`、`repository.ts`。不正日付、利用者の分離、省略、境界日のテストを先に作り実行する。
- [x] 2. OAuth同意と解除：`oauth/consent`、`settings/connections`。SDKのOAuth APIを使用し、既存ログインへの戻り先を確認する。秘密は表示しない。
- [x] 3. MCP入口・認証：`lib/mcp/config.ts`、`auth.ts`、`server.ts`、`api/mcp/route.ts`、公開メタデータ。ローカル署名JWTで不正issuer/audience/client/期限をテストし、未設定は503とする。
- [x] 4. 統合：公式クライアントでinitialize/list/callをテスト。無効設定・未認証を確認。既存テスト・型検査・ビルドを実行。
- [x] 5. セットアップと作業報告：環境変数、OAuth登録、RLS直接拒否試験、未検証の公開作業を明記する。

## Acceptance

`get_goals` と `get_weekly_activity` がテスト用データを返す。Cookieの有無に関係なくMCPはBearer必須。他人のIDを入力できない。データの変更ツールはない。失敗を空の正常結果にしない。実環境で未確認の事項は完了と報告しない。
