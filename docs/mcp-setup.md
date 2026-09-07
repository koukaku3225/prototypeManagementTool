# MCP連携のセットアップ

実装済みのMCPを本番で有効にするための手順です。コードは既定で無効です。SupabaseのOAuthとDB権限を確認する前に `MCP_ENABLED=true` にしないでください。

## 1. Supabase OAuth 2.1 Serverを設定する

Supabase DashboardでOAuth 2.1 Serverを有効にし、認可画面を次のURLに設定します。

```text
https://あなたのドメイン/oauth/consent
```

ChatGPTとClaudeをOAuthクライアントとして登録し、クライアントIDを控えます。動的クライアント登録を使う場合も、登録された全クライアントを自動許可せず、利用するIDだけを環境変数に入れます。

Supabaseの案内：[MCP Authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication)

## 2. RLSを監査する

OAuthの `openid` などのscopeはDBの読み書きを制限しません。DB権限はRLSで制御します。Supabase SQL Editorで現在のポリシーを確認します。このSQLは読み取りだけです。

```sql
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('goal_cards', 'big_stories', 'habits', 'habit_logs', 'timeboxes')
order by tablename, policyname;
```

実際のポリシー名に合わせ、次をすべて満たすよう変更します。

- 通常の利用者は `auth.uid() = user_id` の自分の行だけを扱える。
- 許可したMCPクライアントは自分の行のSELECTだけを許可される。
- MCPのトークンではINSERT、UPDATE、DELETEを許可しない。
- `sessions`、`user_profiles`、`token_usage` はMCPの読み取り対象にしない。
- 既存の広い書き込みポリシーがMCPにも一致しない。許可型ポリシーの追加だけでは、別の許可型ポリシーを打ち消せないため、既存ポリシー側も確認する。

Supabaseの案内：[Token Security and RLS](https://supabase.com/docs/guides/auth/oauth-server/token-security)

公開前にMCPのアクセストークンを使ってREST APIへ直接INSERT・UPDATE・DELETEし、すべて拒否されることを確認します。MCPツールが読み取り専用であるだけでは、この試験の代わりになりません。

## 3. 環境変数を設定する

[`mcp-env.example`](mcp-env.example)を見本に、本番環境へ設定します。

| 変数 | 内容 |
| --- | --- |
| `MCP_RESOURCE_URL` | 公開する `https://.../api/mcp` |
| `MCP_ISSUER` | `https://PROJECT_REF.supabase.co/auth/v1` |
| `MCP_AUDIENCE` | 原則としてMCP_RESOURCE_URLと同じ値 |
| `MCP_JWKS_URL` | Supabaseの署名鍵URL |
| `MCP_ALLOWED_CLIENT_IDS` | 許可したChatGPT・ClaudeのIDをカンマ区切り |
| `MCP_CURSOR_SECRET` | 32文字以上のランダム値。クライアントへ公開しない |

最初は `MCP_ENABLED=false` のままデプロイします。この状態ではMCP入口と認証メタデータが503を返します。

## 4. 接続確認後に有効化する

ステージング環境で次を確認します。

1. `/.well-known/oauth-protected-resource/api/mcp` が正しいresourceとissuerを返す。
2. 未認証の `/api/mcp` が401と認証メタデータの場所を返す。
3. 未登録クライアント、別audience、期限切れトークンが拒否される。
4. 同意画面に連携先・共有項目・同期済みデータのみという説明が表示される。
5. `get_goals` と `get_weekly_activity` が本人の行だけを返す。
6. 別ユーザーの目標IDを指定しても情報が漏れない。
7. RLSの直接書き込み拒否試験が通る。
8. 設定画面から連携を解除できる。

確認後にだけ `MCP_ENABLED=true` に変更します。

## 5. AIからの使い方

接続するMCP URLは `https://あなたのドメイン/api/mcp` です。接続後は次のように依頼できます。

```text
2026-08-31から一週間の記録を取得して、事実・仮説・来週の提案に分けて振り返ってください。
未記録を未実施と断定せず、時間割の予定時間を実測時間として扱わないでください。
```

返却結果に `next_cursor` がある場合は、同じ条件とそのカーソルで続きを取得します。
