# GoogleカレンダーAPIルートの役割

日付：2026-09-14
種別：調査
状態：完了

## 結論

`src/app/api/calendar` の6つの `route.ts` は、Googleカレンダー連携の開始から解除までを役割別に分担している。コード変更は行っていない。

## 依頼と背景

Next.js初学者向けに、各Route Handlerがいつ呼ばれ、何を行うかを現在の実装から確認した。

## 変更内容・調査結果

| URL | 方法 | 役割 |
|---|---|---|
| `/api/calendar/connect` | GET | Googleの許可画面へ移動する |
| `/api/calendar/callback` | GET | Googleから認可コードを受け取り、連携を保存する |
| `/api/calendar/status` | GET | 現在の連携状態を画面へ返す |
| `/api/calendar/sync` | POST | アプリの時間割と専用Googleカレンダーを同期する |
| `/api/calendar/overlay` | GET | 他のGoogleカレンダーの予定を読み取り専用で返す |
| `/api/calendar/disconnect` | POST | 保存済みの連携情報を削除する |

### connect

ユーザーが「Googleカレンダーと連携」を押したときの入口。CSRF対策用の一時的な `state` をCookieへ保存し、必要な権限を指定してGoogleのOAuth許可画面へリダイレクトする。

### callback

Googleの許可画面からアプリへ戻る場所。Cookieの `state` とGoogleから返された値を照合し、認可コードをrefresh tokenへ交換する。その後「目標設定コーチ」という専用カレンダーを作り、tokenとcalendar IDを保存する。

### status

設定画面などが「現在連携中か」を調べるAPI。連携状態、最終同期時刻、直近のエラー、calendar ID、接続時刻を返す。秘密のrefresh tokenは返さない。DB障害時は、未連携と断定せず `unknown: true` を返す。

### sync

画面から受け取った時間割をzodで検証し、同期エンジンへ渡す。アプリ専用カレンダーへの予定作成・更新・削除判断を担当する。失敗しても時間割画面を壊さないよう、例外を `{ ok: false }` に変換する。

### overlay

指定日の既存Google予定を読み、アプリの時間割へ重ねて表示するためのデータを返す。専用カレンダーは除外し、本人がGoogle側で表示対象にしたカレンダーを最大8個まで並列取得する。この予定はアプリの時間割として保存せず、Googleへ書き戻さない。

### disconnect

アプリに保存したGoogle連携情報を削除する。Googleカレンダー側の予定や専用カレンダーは、取り返しのつかない削除を避けるため消さない。

## 仕組みの説明

```text
連携ボタン
  ↓ connect
Googleの許可画面
  ↓ callback
連携情報を保存
  ├─ status      連携状態を見る
  ├─ sync        アプリの時間割を専用カレンダーと同期する
  ├─ overlay     既存のGoogle予定を読み、画面に重ねる
  └─ disconnect  アプリ側の連携情報を消す
```

Next.jsでは、`app/api/calendar/connect/route.ts` のフォルダ階層が `/api/calendar/connect` というURLになり、ファイル内の `GET` や `POST` 関数がHTTPメソッドに対応する。

## 関連ファイル・根拠

- [連携開始](../../src/app/api/calendar/connect/route.ts)
- [OAuthコールバック](../../src/app/api/calendar/callback/route.ts)
- [連携状態](../../src/app/api/calendar/status/route.ts)
- [時間割同期](../../src/app/api/calendar/sync/route.ts)
- [予定の重ね表示](../../src/app/api/calendar/overlay/route.ts)
- [連携解除](../../src/app/api/calendar/disconnect/route.ts)

## 確認したこと

6つのRoute Handlerについて、HTTPメソッド、入力検証、呼び出しているカレンダー処理、返却内容、失敗時の扱いをコードから確認した。コード変更を伴わない説明のため、テストとビルドは実施していない。

## 残っていること

各ルートの役割確認として残件はない。Google APIとの通信処理の詳細は `src/lib/calendar` に分離されている。
