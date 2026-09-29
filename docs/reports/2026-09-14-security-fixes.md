# 時間割の選択解除と、セキュリティレビュー指摘の修正

日付：2026-09-14
種別：修正
状態：一部完了（コードで直せる指摘は修正済み。DB権限に関わる指摘5・6は本人の判断待ち）

## 結論

- 時間割で長押しして選んだ枠は、**その枠以外のどこを触っても選択が外れる**ようになった（見出し・時間割の外枠・別の枠）。選んだ枠自身と丸いつまみを触ったときだけ残る。
- [セキュリティレビュー](2026-09-14-security-review.md)の13件＋補足のうち、**11件と補足（本文サイズ）をコードで修正**した。レビュー時の再現手順を修正後の期待値で走らせ直す [検証スクリプト](security-fix-verification.cjs) で、15項目すべてが修正後の挙動になったことを確認した。
- 指摘5・6は本番DBの権限変更（マイグレーション）とサーバー専用鍵の導入が要るため、今回は実施していない。本番の設定を読み取りだけで確認した結果を下に書く。

## 依頼と背景

1. タイムボクシングで枠を触ったあと、次の操作で外枠を触っても選択（つまみ）が残ったままになる。
2. レビューで見つかった脆弱性に対策する。

## 変更内容・調査結果

### 1. 時間割の選択解除

変更前は、時間割の「空いているところ」をクリックしたときだけ選択を外していた。[DayGrid.tsx](../../src/components/DayGrid.tsx) で、選択中だけ `document` に `pointerdown`（capture）を張り、押された場所が選んだ枠（`data-box-id` が一致する要素、つまみを含む）の外なら選択を外す。

### 2. セキュリティ修正

| 指摘 | 変更 |
|---|---|
| 1 バックアップAPIが無認証 | 本番・Vercelでは404。Hostがloopbackでなければ404。別サイトからの送信と専用ヘッダ `x-gc-local-backup` 無しは403。`npm run dev` を `127.0.0.1` 待ち受けに変更（HostヘッダはLANから偽装できるため） |
| 2 別アカウントへ自動送信 | 端末のデータが別アカウントとして同期されていた場合（`gc.syncedUser` が別人）、自動 push せず conflict にして本人に選ばせる。設定画面の文言も「別のアカウントのデータが残っています」に分岐 |
| 3 Content-Type すり抜け | MIMEタイプを完全一致で判定。JSON API・カレンダー解除は別サイトからの送信（Sec-Fetch-Site / Origin）を403 |
| 4 認証・制限が開く | 本番で Upstash が未設定・障害のとき、無制限ではなくメモリ上の代替上限（通常と同じ値、インスタンス単位）で数える。開発環境の無制限は維持 |
| 7 同期がアカウント切替をまたぐ | `pullAll` はDB応答後に利用者を再確認してから書き戻す。`backfillAll` は開始時の利用者を各送信に渡し、切り替わったら残りを送らない |
| 8 復元で削除だけ通知 | 復元中は同期通知を止め、成功後に書き戻した値だけを通知。書き戻し失敗時は元のデータへ戻す |
| 9 細工したJSONで消去・無限ループ | 消す前に検証（アプリのキーが1つ以上・値がJSON・版番号は0〜現在の整数）。保存済みの版番号が壊れていても移行は有限回で終わる |
| 10 JWKSを毎回取得 | 公開鍵の取得口をURLごとに使い回す。MCPの認証前にIP単位の入口制限 |
| 11 MCPバッチで20倍 | バッチ件数ぶん制限枠を消費 |
| 12 カレンダー同期の増幅 | 1回のGoogle書き込みを100件まで（残りは次回）、一覧取得は20ページまで、利用者ごとの同時同期を禁止、回数制限を追加 |
| 13 OAuth stateが利用者と無関係 | state Cookie に開始した利用者IDを入れ、callback時の利用者と違えば保存しない |
| 補足 本文サイズ | 読みながらバイト数を数え、超えた時点で打ち切る（`Content-Length` も先に確認） |

### 指摘5・6（未修正）：本番DBの確認結果（読み取りのみ）

- 全テーブルのRLSは「本人の行ならすべての操作を許可」の1本だけで、`client_id` による区別は無い。`anon` / `authenticated` ロールに全権限が付与されている。
- `auth.oauth_clients` は **0件**。外部AI（MCP）のOAuthクライアントが未登録なので、指摘5は現時点では悪用の入口が無い。**クライアントを登録する前に**対策が必要。
- `google_calendar_links` は1行あり、本人のセッションで `refresh_token` を直接SELECTできる設計のまま（指摘6は現存）。直すには、サーバー専用の資格情報（service role 鍵をVercelに設定）か、トークン列の権限剥奪＋SECURITY DEFINER関数への移行が要る。

## 仕組みの説明

- **出どころの確認**：ブラウザは送信のたびに `Sec-Fetch-Site`（同じサイトからか）を付け、ページ側から書き換えられない。これが `same-origin` 以外なら、他人のページに踏まされた送信とみなして断る。
- **同期の持ち主**：非同期処理は `await` の間に別の出来事（ログアウト）が挟まる。C++で言えば、完了通知を受けたときに「依頼したときの相手と今の相手が同じか」を毎回見る形にした。
- **代替上限**：Upstash（共有カウンタ）が使えないときは、各サーバーのメモリで数える。サーバーが複数台あると合計は緩くなるが、無制限よりずっと狭い。

## 関連ファイル・根拠

- [src/components/DayGrid.tsx](../../src/components/DayGrid.tsx) — 選択解除
- [src/lib/request-guard.ts](../../src/lib/request-guard.ts) — Content-Type・出どころ・本文サイズ・loopback の判定（新規）
- [src/lib/api-schema.ts](../../src/lib/api-schema.ts) — `parseBody` を上記に置き換え
- [src/app/api/local-backup/route.ts](../../src/app/api/local-backup/route.ts)、[src/components/LocalBackupBoot.tsx](../../src/components/LocalBackupBoot.tsx)、[package.json](../../package.json) — 指摘1
- [src/lib/storage.ts](../../src/lib/storage.ts) — 指摘8・9
- [src/lib/supabase/sync.ts](../../src/lib/supabase/sync.ts)、[sync-decision.ts](../../src/lib/supabase/sync-decision.ts)、[settings/page.tsx](../../src/app/settings/page.tsx) — 指摘2・7
- [src/lib/rate-limit.ts](../../src/lib/rate-limit.ts)、[src/app/api/mcp/route.ts](../../src/app/api/mcp/route.ts)、[src/lib/mcp/auth.ts](../../src/lib/mcp/auth.ts) — 指摘4・10・11
- [src/lib/calendar/engine.ts](../../src/lib/calendar/engine.ts)、[google.ts](../../src/lib/calendar/google.ts)、[api/calendar/sync](../../src/app/api/calendar/sync/route.ts)、[disconnect](../../src/app/api/calendar/disconnect/route.ts) — 指摘12・3
- [src/lib/calendar/oauth-state.ts](../../src/lib/calendar/oauth-state.ts)、[link.ts](../../src/lib/calendar/link.ts)、[connect](../../src/app/api/calendar/connect/route.ts)、[callback](../../src/app/api/calendar/callback/route.ts) — 指摘13
- テスト：[tests/security-guards.test.mjs](../../tests/security-guards.test.mjs)（新規）、[tests/storage.test.mjs](../../tests/storage.test.mjs)、[tests/sync-decision.test.mjs](../../tests/sync-decision.test.mjs)

## 確認したこと

- **選択解除**：ローカル開発サーバーをスマホ幅で開き、架空の枠2件を入れて長押し（touch の pointer イベント）で選択 → 見出し・時間割の外枠・別の枠を触ると選択が外れ、選んだ枠のつまみを触ると残ることを確認。つまみを引いて長さを変える操作（10:00〜11:00 → 12:00）も引き続き動いた。テストデータは削除し、検証中に増えたローカルバックアップの世代ファイルも元に戻した。
- **型チェック**：`tsc --noEmit` エラーなし。
- **テスト**：`npm test` 全件成功（追加：security-guards 12件、storage 6件、sync-decision 2件）。
- **再現手順の再実行**：[security-fix-verification.cjs](security-fix-verification.cjs) で15項目すべて修正後の挙動。修正前の [security-review-evidence.cjs](security-review-evidence.cjs) は最初の確認（無関係JSONで消える）で失敗するようになった。
- **実ブラウザ（ローカル）**：同一オリジンから、バックアップGET（ヘッダ付き）200・ヘッダなし403・POST 200、chat の不正本文400、偽装Content-Type 415、カレンダー同期の不正本文400。正規の画面操作が403にならないことを確認。
- **本番（コミット 731edbe、Vercelビルド反映後）**：本番URLのページから、バックアップAPI 404、chat の不正本文400・偽装Content-Type 415、カレンダー同期の不正本文400。配信中のJSに選択解除のコード（`data-box-id`）が入っていることを確認。
- **本番で未確認**：選択解除の実操作。確認に使ったブラウザがログイン状態でローカルに枠が無く、テスト用の枠を入れるとクラウドの実データを上書きしうるため行っていない。ローカルで同じコードの動作を確認済み。

## 残っていること

1. **指摘5**：MCPのOAuthクライアントを登録する前に、`client_id` を考慮したRLS・列権限と、外部AIトークンでの直接SELECT/INSERT拒否試験を行う（いまは0件なので入口なし）。
2. **指摘6**：Googleの refresh_token をユーザーのセッションから読めないようにする。service role 鍵をVercelへ設定するか、SECURITY DEFINER 関数へ移すかの選択が要る（本番DBの変更）。
3. **指摘2の残り**：ログアウト後も同じブラウザでは前の人のデータが画面に見える。データ消失事故の経緯があるため、ログアウト時の消去・隠蔽は入れていない。共有端末で使う予定があるかで判断する。
4. **CSPの `unsafe-inline`**：nonce化は未着手（XSSの実経路は見つかっていない）。
5. カレンダー同期の AbortSignal 伝播は未着手（書き込み件数の上限で増幅は抑えた）。
6. `npm run dev` は 127.0.0.1 待ち受けになった。LAN内のスマホから開発サーバーを開く使い方はできなくなる（本番URLは影響なし）。いま動いている開発サーバーは再起動するまで旧設定のまま。
7. 本番の Upstash 設定が生きているか・Anthropic 側の支出上限は未確認。
