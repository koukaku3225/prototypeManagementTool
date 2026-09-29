# 9/20分 コードレビュー報告（定期実行）

日付：2026-09-21
種別：調査（コード変更なし）
状態：完了

## 結論

**報告すべき問題は見つからなかった。通知も不要。** 9/20（JST）にコミットされたコード変更は2件（`cc8453c`・`ef79339`）。`2e0e54a` は docs のみ。
テストと型チェックは通り、差分と周辺コードを読んだ範囲では、データ消失・古い state での上書き・日付・入力検証・XSS の既知パターンに該当しなかった。
前回（9/19分）で「次回以降に見る」とした `useDayRollover` の呼び出し側も、今回コミット済みの状態で確認した。

## 依頼と背景

前日（日本時間 9/20 0:00〜23:59）に作られたコミットと、現在の未コミット変更を確認する定期タスク。
コードの編集・コミット・依存更新・実データの変更は行っていない（この報告ファイルだけを追加した）。

## 調査結果

### 対象にしたコミット（9/20 JST）

| コミット | 時刻 | 内容 | 判定 |
|---|---|---|---|
| `cc8453c` | 02:17 | 削除済み予定の件数・表示を画面どうしでそろえる、`nearestActive` が `now` を使うようにする、連続0日で「保険を使用中」と出さない | 問題なし |
| `2e0e54a` | 02:22 | 棚卸し報告と残件の更新のみ（docs） | コード変更なし |
| `ef79339` | 03:14 | 開きっぱなしの画面が日付をまたいだら読み直す（`rolledDay` / `createDayWatcher` / `useDayRollover`、6画面に適用） | 問題なし |

`0b52173`・`fd72ed9` は 9/21 のコミットで今回の対象ではない（次回 9/21分で見る）。

### 未コミットの変更（前日の変更とは断定しない）

`src/lib/habit.ts`・`src/types/behavior.ts`・`src/components/HabitCheck.tsx`・`tests/habit.test.mjs`。
週N回の習慣に「今週の進み具合（`thisWeek`）」を持たせ、今週の目安に届いたら今日の一覧（`dueToday`）から外す変更。
作業中の可能性があるので詳細な指摘はしていないが、次の点だけ確認した。

- `dueToday` の利用箇所は `list/page.tsx` の `todayHabits` のみ。`computeStats(h, logs)` は既定の `today()` を使うので、日付は合っている。
- 今日すでに記録した習慣は `todayLog !== null` で残るため、押した結果が消えない。
- `habit-plan.ts` は週N回を時間割に並べない（`canPlace`）ので、今日の画面と時間割で見え方が食い違う経路はない。
- `HabitStats` に必須フィールド `thisWeek` を足したが、`tsc` は通る（他に `HabitStats` を組み立てている箇所がない）。

### 確認した観点

- **データ消失・古い state による上書き**: `useDayRollover` の呼び出し側は、`list`・`goals`・`checkpoints`・`me` が `reload()`（localStorage を読み直して state に入れるだけ）、`goal/[id]` は読み直さず `day` を更新して描き直すだけ、`plan` は「今日を見ていた人だけ `setDate`、そうでなければ `reload(date)`」。**保存データを書き込む経路はない**。編集シート（`editing`）の state は `reload` で触られない。前回の宿題だった「読み直しが入力途中の状態を消さないか」は、`goal/[id]` を読み直さない設計にしてあり、消える経路は見つからなかった。
- **日跨ぎ判定**: `rolledDay` は `toLocalDate`（ローカル日付）で比較しており、UTC 切り出しはない。`createDayWatcher` は1回知らせたら覚えている日を進めるので、30秒ごとの確認・フォーカス・`pageshow` が重なっても二重に読み直さない。日付が戻った場合も「違う日」として扱う。
- **`nearestActive`（`cc8453c`）**: 呼び出し元は `goals/page.tsx` の `GoalRow` だけ。期間が残っているものを先に返し、無ければ最近終わったものを返す。`GoalRow` は同じ既定 `today()` で `isPeriodOver` を見るので、「期間が終わりました」表示と選び方がずれない。
- **`computeStreak`（`cc8453c`）**: `freezeUsed: streak > 0 && freezeUsed`。`freezeLeft` の計算は `freezeUsed ? 0 : 1` のままで、連続0日のとき保険が1回残っている表示になるだけ。整合している。
- **件数の分母**（`cc8453c`）: `list/page.tsx` の `plannedCount` は `countsAsPlanned` を通り、時間の合計と同じ基準。
- **日付の書き方**: `src` 全体を `.slice(0, 10)`・`toISOString().slice`・`split("T")` で検索する既存ルールに、新しい違反はない（`tests/forbidden.test.mjs` も通過）。
- **API・認証・プロンプト・ストリーム中断・対話フェーズ**: `src/app/api/` と `PHASE_INSTRUCTIONS` / `PHASE_TURN_LIMIT` に変更なし。該当なし。
- **テストの未登録**: 新規の `tests/day-watch.test.mjs` は `package.json` の `test` に登録されている（`ef79339` で追加済み）。

## 関連ファイル・根拠

- [src/hooks/useDayRollover.ts](../../src/hooks/useDayRollover.ts)・[src/lib/day-watch.ts](../../src/lib/day-watch.ts)・[src/lib/date.ts](../../src/lib/date.ts) — 日跨ぎの判定
- [src/app/plan/page.tsx](../../src/app/plan/page.tsx) — 「今日を見ていた人だけ進める」処理
- [src/lib/checkpoint.ts](../../src/lib/checkpoint.ts) — `nearestActive`
- [src/lib/habit.ts](../../src/lib/habit.ts) — `computeStreak`、未コミットの `computeStats`
- [docs/reports/2026-09-20-daily-code-review-0919分.md](2026-09-20-daily-code-review-0919分.md) — 前回（9/19分）の報告。今回はそこで確認済みの変更を再確認していない

## 確認したこと

| チェック | 結果 |
|---|---|
| `npm test` | 全件パス（終了コード 0）。`calendar-engine` のテストが `[calendar/sync] … rateLimitExceeded` などのログを出すが、失敗ケースを意図的に流すテストの出力で、判定は `passed` |
| `npx tsc --noEmit` | エラーなし（終了コード 0） |
| `tests/forbidden.test.mjs` | 139ファイル走査、該当なし |
| `npm run build` | **実行しなかった**（下記） |

**ビルドを見送った理由**: 作業ツリーに未コミットの変更があり、ビルドすると 9/20 のコミットではなく作業中の変更を検証することになる。`next dev` が動いていれば、同じ `.next` を `next build` が書き換えて壊す恐れもある。`ef79339` のコミットメッセージに、その時点でのビルド通過が記載されている（今回は再確認していない）。

**確認できていないこと**: 日付をまたぐ実機確認。`ef79339` のコミットメッセージ自体が「日付をまたぐ実機確認は未実施（残件 R30）」と書いている。テストは時計を差し替えた判定ロジック（`rolledDay`・`createDayWatcher`）までで、ブラウザで `visibilitychange` / `pageshow` から画面が読み直される流れは、コードを読んだだけで動かして見ていない。

## 残っていること

- 報告すべき問題はなし。
- R30（日跨ぎの実機確認）は本人側の残件のまま。定期レビューの範囲では判断できない。
- 9/21 分（`0b52173`：週N回の数え方、`CoachAvatar` の分離）は、次回 9/21分で見る。未コミットの `thisWeek` の変更もそのときコミットされていれば対象になる。
