# 9/22分 コードレビュー報告（定期実行）

日付：2026-09-23
種別：調査（コード変更なし）
状態：完了

## 結論

**報告すべき問題は見つからなかった。** 9/22（JST）にコミットされたコード変更は2件（`d324970`・`e9e2d4d`）で、残り2件（`f245981`・`2eb7a05`）は docs のみ。テストと型チェックは通り、差分と周辺コード・追加テストを読んだ範囲では、データ消失・古い state による上書き・日付や日跨ぎの判定ミス・APIの入力検証・ストリーム中断処理・XSS の既知パターンに該当しなかった。未コミットの変更はなし（作業ツリーは docs/reports の新規ファイルのみ）。

## 依頼と背景

前日（日本時間 9/22 0:00〜23:59）に作られたコミットと、現在の未コミット変更を確認する定期タスク。コードの編集・コミット・依存更新・実データの変更は行っていない（この報告ファイルだけを追加した）。

## 調査結果

### 対象にしたコミット（9/22 JST）

| コミット | 時刻 | 内容 | 判定 |
|---|---|---|---|
| `d324970` | 02:30 | `dueLabel`（期限用）を時間割の日付見出し・ヒートマップのマスに誤用していたのをやめ、ただの日付ラベル `dayLabel(date, base?)` に置き換え | 問題なし |
| `f245981` | 02:33 | 報告の追記のみ（docs） | コード変更なし |
| `e9e2d4d` | 03:15 | 対話のSSEが `done` なしで閉じても成功扱いになり画面が固まる不具合を修正（`consumeSse` を `sse-client.ts` に切り出し）。日をまたいだ打刻を止めたとき、記録されない時間を帯に表示するよう修正（`runningSpan`／`runningCutNote`） | 問題なし |
| `2eb7a05` | 03:16 | 報告の追記のみ（docs、打刻の本番確認結果を残件.mdに反映） | コード変更なし |

### 確認した観点（事実）

- **`dayLabel`（`d324970`）**: `diffDays(base, date)` は `date - base` を返す実装のため、`d===1`→明日・`d===-1`→昨日の符号は正しい。呼び出し元は `plan/page.tsx`（時間割の日付見出し）と `Heatmap.tsx`（マスの読み上げ文言）の2箇所のみで、両方とも `dueLabel` から差し替え済み。`grep` で `dueLabel` の残存参照を確認したが、`date.ts` 内のコメント（経緯の説明）以外に呼び出しは残っていない。期限の残り表示は従来どおり `deadlineCountdown` が受け持ち、影響を受けていない。
- **テスト（`tests/date.test.mjs`）**: 今日・前後2日・N日前後・基準日を渡すケース・空文字のケースをカバー。「先の日付をそのまま返さない（`dayLabel(addDays(5))` ≠ `addDays(5)`）」という回帰も明示的にテストされている。
- **SSE切断（`e9e2d4d`）**: `consumeSse` は `done` イベントを受け取れないままストリームが閉じると `STREAM_CUT_MESSAGE` で例外を投げる。`error` イベントを受けた場合は `onError` がその場で例外を投げる実装（`useConversation.ts`）なので、`error` の文言が末尾の `STREAM_CUT_MESSAGE` で上書きされることはない（`tests/sse-client.test.mjs` の「サーバーが error を送ってきたら、その文言のまま例外になる」で確認済み）。壊れたJSONフレームも日本語の案内に変換される。チャンク境界で多バイト文字が割れるケースもテストされている。
- **打刻の日またぎ（`e9e2d4d`）**: `runningSpan` は記録の切り方（始めた日の24時まで）を変えずに、経過時間（`elapsedMin`）と記録される時間（`recordedMin`）の差分（`lostMin`）を計算する。3日以上経過してから止めるケース（`elapsedMin=72h` でも `recordedMin` は始めた日の残り時間のみ）もテストされており、多日またぎでも壊れない。`stopRunning`（`storage.ts`）も同じ `runningSpan` を通すよう統一され、以前は未テストだった `stopRunning` の日またぎ挙動も `tests/storage.test.mjs` で固定された。
- **API・認証・プロンプトインジェクション**: 9/22 のコミットで `src/app/api/` に変更なし。該当なし。
- **対話フェーズ（`PHASE_INSTRUCTIONS`／`PHASE_TURN_LIMIT`）**: 変更なし。該当なし。
- **保存データ・Supabase同期**: 9/22 のコミットは表示ロジック（`dayLabel`）と打刻の計算・表示（`runningSpan`）の変更で、localStorageのキー追加やSupabaseマッパーの対象拡張はない。`AGENTS.md` が求める「新しいテーブルをSupabaseに足したら〜」の対応漏れチェックは非該当。

### 未コミットの変更

作業ツリーの差分は `docs/reports/` 配下の新規ファイル（過去日付のレポート群）と `.agents/skills/web-for-cpp-explainer/`（無関係なスキル追加）のみで、`git diff --stat` に追跡ファイルの変更はなし。前日のコード変更に該当するものはなかった。

### 既知の残件（新規指摘ではなく状況確認のみ）

`残件.md` の R33（対話の途切れ時の画面を実機で未確認）はユーザー側で既に追跡済み。打刻の日またぎ表示は本番URLで確認済みだが、対話の途切れ表示（`STREAM_CUT_MESSAGE` のUI）は「開発者ツールで応答を途中で止める」実機確認が済んでいない旨が `2eb7a05` の時点で明記されている。ロジックとテストは今回の確認で妥当と判断できたため、新規の指摘としては扱わない。

## 関連ファイル・根拠

- [src/lib/date.ts](../../src/lib/date.ts) — `dayLabel`・`diffDays`・`deadlineCountdown`
- [src/app/plan/page.tsx](../../src/app/plan/page.tsx)・[src/components/Heatmap.tsx](../../src/components/Heatmap.tsx) — `dayLabel` の呼び出し箇所
- [src/lib/sse-client.ts](../../src/lib/sse-client.ts)・[src/hooks/useConversation.ts](../../src/hooks/useConversation.ts) — `consumeSse`・`onError` の例外経路
- [src/lib/timebox.ts](../../src/lib/timebox.ts) — `runningSpan`・`runningCutNote`
- [src/lib/storage.ts](../../src/lib/storage.ts) — `stopRunning`
- [src/components/RunningBar.tsx](../../src/components/RunningBar.tsx) — 帯の表示
- [残件.md](../../残件.md) — R33（対話の途切れの実機未確認）
- [docs/reports/2026-09-22-daily-code-review-0921分.md](2026-09-22-daily-code-review-0921分.md) — 前回（9/21分）の報告。そこで確認済みの変更・指摘（`sse-client.test.mjs` の登録漏れ）は今回解消を確認済み

## 確認したこと

| チェック | 結果 |
|---|---|
| `npm test` | 全件パス（終了コード 0）。`calendar-engine` のテストが `GoogleApiError` などのログを出すが、失敗ケースを意図的に流すテストの出力で、判定は `passed`（前回までと同様） |
| `npx tsc --noEmit` | エラーなし（終了コード 0） |
| `tests/forbidden.test.mjs` | 140ファイル走査、該当なし |
| `npm run build` | 実行しなかった（未コミットの変更がコードに影響しないdocsのみであることを先に確認したため、コミット済みコードは`npm test`／`tsc`で担保し、開発サーバーとの競合を避けた） |

前回（9/21分）に指摘した「`tests/sse-client.test.mjs` が `package.json` の `test` に未登録」は、`e9e2d4d` で登録済みであることを確認した（再指摘なし）。

## 残っていること

- 報告すべき新しい問題はなし。
- R33（対話の途切れ時の画面確認）は本レビューの対象外の残件として、既存トラッキング（`残件.md`）に委ねる。
