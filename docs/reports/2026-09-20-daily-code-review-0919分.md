# 9/19分 コードレビュー報告（定期実行）

日付：2026-09-20
種別：調査（コード変更なし）
状態：完了

## 結論

**報告すべき問題は見つからなかった。通知も不要。** 9/19（JST）にコミットされたコード変更は3件（`8ed313e`・`3bda7ce`・`5dcd60d`）。
テストと型チェックは通り、差分を読んだ範囲では、データ消失・古い state での上書き・日付・入力検証・XSS の既知パターンに該当しなかった。

`npm test` を1回だけ失敗した状態で見たが、これは別セッションが作業ツリーを編集している最中だったため（詳細は「確認したこと」）。9/19分の変更が原因ではない。

## 依頼と背景

前日（日本時間 9/19 0:00〜23:59）に作られたコミットと現在の未コミット変更を確認し、品質上の問題を報告する定期タスク。
コードの編集・コミット・依存更新・実データの変更は行わない（この報告ファイルだけを追加した）。

## 調査結果

### 対象にしたコミット（9/19 JST）

| コミット | 時刻 | 内容 | 判定 |
|---|---|---|---|
| `8ed313e` | 02:22 | Google で消された予定を時間の合計・中間目標の進み具合から外す（`countsAsPlanned` / `countsForCheckpoint`）。完了にした中間目標を「できた」と見せる | 問題なし |
| `7cecd1b` | 02:32 | 棚卸し報告と残件の更新のみ（docs） | コード変更なし |
| `3bda7ce` | 03:14 | 目標・対話ログ書き出しの「作成日」を UTC 切り出しから `toLocalDate` に変更 | 問題なし |
| `5dcd60d` | 09:56 | スマホの時間割ドラッグ（`touchmove` を止める、タップ判定の `pressOutcome`）、「完了にする」と「閉じる」の左右入れ替え | 問題なし |

`cc8453c`・`2e0e54a` は 9/20 02:17〜02:22 のコミットで、今回の対象（9/19）ではない。
ただし `8ed313e` の集計基準が他画面と食い違っていないかを見るため、`cc8453c` の内容は参照した（下記）。

### 未コミットの変更（前日の変更とは断定しない）

`src/lib/date.ts`（`rolledDay` 追加）、`src/hooks/useDayRollover.ts`（新規）、`src/app/{checkpoints,goals,list,me,plan}/page.tsx`、`tests/date.test.mjs`。
「開きっぱなしの画面が日付をまたいだら読み直す」機能で、**作業ツリーを別セッションが今も編集している最中**（調査中に `me/page.tsx` の変更が増えた）。
着手中のものなのでコミット済みの変更とは区別し、詳細な指摘はしていない。完成してコミットされた後の回で見る。

### 確認した観点

- **データ消失・古い state による上書き**: 9/19 の変更に、保存内容を古い値で置き換える経路はない。`3bda7ce` は表示・ファイル名だけ、`8ed313e` は集計の絞り込みだけで、保存データは書き換えない。`5dcd60d` の `pressOutcome` は「確定するか・タップ扱いか」を決めるだけで、確定処理（`onCommit` / `onCreate`）の呼び出し回数は変わらない。
- **日付**: `src` 全体を `.slice(0, 10)`・`toISOString().slice`・`split("T")` で検索した。残っているのは `mappers.ts:29`（`YYYY-MM-DD` の往復検証で、UTC 同士の比較なので正しい）と、`date.ts` のコメントだけ。`3bda7ce` の4箇所はすべて `toLocalDate` に置き換わっている。
- **集計基準のそろい方**（`8ed313e`）: `totalMinutes` / `shareByCard` / `countsForCheckpoint` / 件数（`plan/page.tsx`・`list/page.tsx`）が同じ `countsAsPlanned` を通っている。`goals/page.tsx` の「今週・累計」も `totalMinutes` 経由。`durationMin` を直接足している箇所は `checkpoint.ts` の進み具合だけで、そこは `countsForCheckpoint` で絞ってある。
- **完了にした中間目標**（`8ed313e`）: 「達成」型は `met = (status === "done")` なので、取り消し線の条件を `finished`（`status === "done"`）に変えても、達成型の見え方は変わらない。
- **ドラッグ処理**（`5dcd60d`）: 追加した `touchmove` の `preventDefault` は `origin.current` があるときだけ効く。`origin` は長押し成立後の `begin()` でのみ設定され、長押し待ちの間は別の `pending` に入るため、長押し前のスクロールは妨げない。`MOVE_SLOP_PX`（4）はマウスの開始しきい値 `CREATE_SLOP_PX`（6）より小さく、マウスで引き始めた直後に「動かしていない」扱いになる矛盾も起きない。
- **API・認証・プロンプト・ストリーム中断・対話フェーズ**: `src/app/api/` と対話フェーズ関連（`PHASE_INSTRUCTIONS` / `PHASE_TURN_LIMIT`）に変更なし。該当なし。
- **XSS・秘密情報**: `tests/forbidden.test.mjs` が 137 ファイルを走査して該当なし。
- **テストの未登録**: `tests/*.test.mjs` の全ファイルが `package.json` の `test` に登録されている（登録漏れなし）。

## 関連ファイル・根拠

- [src/lib/timebox.ts](../../src/lib/timebox.ts) — `countsAsPlanned`（合計の基準）
- [src/lib/checkpoint.ts](../../src/lib/checkpoint.ts) — `countsForCheckpoint`、`checkpointProgress`
- [src/hooks/useGridDrag.ts](../../src/hooks/useGridDrag.ts)・[src/lib/grid-gesture.ts](../../src/lib/grid-gesture.ts) — スマホのドラッグ判定
- [src/lib/export.ts](../../src/lib/export.ts) — 作成日の書き出し
- [docs/reports/2026-09-19-daily-code-review-0918分.md](2026-09-19-daily-code-review-0918分.md) — 前回（9/18分）の報告。今回はそこで確認済みの変更を再確認していない

## 確認したこと

| チェック | 結果 |
|---|---|
| `npm test` | 最終実行は全件パス（終了コード 0）。途中で1回、`tests/date.test.mjs` の `rolledDay` 6件が失敗した（下記） |
| `npx tsc --noEmit` | エラーなし（終了コード 0） |
| `tests/forbidden.test.mjs` | 137ファイル走査、該当なし |
| `npm run build` | **実行しなかった**（下記） |

**`npm test` が一度失敗した件の切り分け（環境要因）**: 失敗は `rolledDay is not defined`。テスト側（`tests/date.test.mjs`）が `rolledDay` を import した時点で、`src/lib/date.ts` にはまだ追加されていなかったため。
`date.ts` / `useDayRollover.ts` / `date.test.mjs` の更新時刻が 03:08〜03:09 で、現在時刻 03:10 の直前だった。約1分後の再実行では全件通った。
つまり別セッションが `rolledDay` を追加する途中の状態を拾っただけで、9/19 のコミットとは無関係。

**ビルドを見送った理由**: 作業ツリーが別セッションの編集途中で、ビルドすると 9/19 のコミットではなく作業中の変更を検証することになる。また、そのセッションが `next dev` を動かしていれば、同じ `.next` を `next build` が書き換えて壊す恐れがある。9/19 の変更は型チェックとテストで検証できており、前回（9/18分）のビルドは成功している。

**確認できていないこと**: `5dcd60d` のスマホ実機での動作（長押し・ドラッグ・タップ）は、コードを読んだだけで実機では見ていない。コミットメッセージには原因の説明があるが、実機確認の記載はない。

## 残っていること

- 報告すべき問題はなし。
- 別セッションの「日跨ぎで読み直す」変更がコミットされたら、次回以降で `useDayRollover` の呼び出し側（読み直しが入力途中の状態を消さないか）を見る。
- `5dcd60d` のスマホ操作は、本人が実機で使って気づいた時点で確認できる。定期レビューの範囲では判断できない。
