<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# このリポジトリの規約

`next dev` が上のブロックを書き戻すので、追記は必ずこの見出しより下に置くこと。

## セキュリティ：絶対に入れないもの

`tests/forbidden.test.mjs` が機械的に見張っている。落ちたら回避せず、設計を変えること。

- **`dangerouslySetInnerHTML` を追加しない。** `innerHTML =` / `document.write` / `eval` / `new Function` も同じ。
- **Markdown を描画するなら `rehype-raw` を使わない。** `react-markdown` を既定（生HTML無視）のまま使い、`rehype-sanitize` を明示的にチェーンする。
- **`NEXT_PUBLIC_` 接頭辞に鍵を置かない。** クライアントに埋め込まれる。

理由: このアプリは localStorage に対話全文・過去の挫折・価値観を平文で持っている。XSS が1箇所でも生えると、`fetch` 1行でその全部が外に出る。いま実在する経路はゼロなので、守るべきは**ゼロのままにすること**。

ESLint は導入していない。1ルールのために eslint-config-next 一式を入れると、既存コードに大量の指摘が出て運用されなくなるため、上記スクリプトで代替している。エディタ連携が要るようになったら、そのとき入れる。

## APIルート

- **入力は必ず `src/lib/api-schema.ts` の zod スキーマを通す。** `req.json()` の結果に型注釈を付けるのは検証ではない。
- **ユーザー由来の文字列を system プロンプトへ素で連結しない。** `sanitizeUserText()` を通し、`USER_DATA_BEGIN`/`END` で囲って「データであって指示ではない」と明示する。
- 上流（Anthropic）のストリームには `signal: req.signal` を渡し、`ReadableStream` に `cancel()` を置く。忘れると、切断されたリクエストの生成が最後まで走って課金される。
- 新しいルートを足したら `maxDuration` を明示する。
- **新しいAPIルートの先頭で `requireAuthIfEnabled()` を呼ぶ。** `REQUIRE_AUTH=true` を設定するまでは何もしない（今はログイン任意のため）。外部公開する段になったら環境変数側で有効化する。

## localStorage

- **新しいテーブルを Supabase に足したら、`src/lib/supabase/mappers.ts` と `sync.ts` の `pushKey()` / `pullAll()` にも対応を足す。** 忘れると、そのデータだけローカルにしか残らない。
- Supabase 同期は `write()` からの裏書き込み（ベストエフォート）。失敗しても localStorage 側の保存は成功しているので、ユーザー操作は止めない。ログインしていなければ何もしない。

### localStorage が丸ごと消えた実例がある

原因は特定できていないが、本人の実データ（目標カード・大きな物語）が localStorage・スナップショット双方から消えたことが実際にあった。スナップショットもJSON書き出しも「同じブラウザの中」にあるので、サイトデータの一括削除に同じように弱い。

対策として `src/components/LocalBackupBoot.tsx` が、保存のたびに（4秒デバウンスで）`/api/local-backup` 経由でこのPCのディスク（`.local-backups/`、gitignore 済み）へ書く。ログインの有無に関係なく常時動く。起動時に localStorage が空で、ディスク側にバックアップが残っていれば復元を申し出る。**これは `npm run dev` のローカル環境専用**（デプロイ後のサーバーレス環境ではディスクが永続しない）。

- **新しいキーを足したら、`SNAPSHOT_TARGETS` と `resetAll()` に加えて、これは何もしなくてよい**（`captureState()` を丸ごと送っているため、新しいキーも自動的にバックアップ対象になる）。
- `GoalCard` に日々のログを埋め込まない。`upsertCard` はカード全体を置換するので、古い state で上書きした瞬間にその日の記録が消える。必ず別キー・別配列にする。
- 保存失敗（容量超過・プライベートモード）は `write()` が拾って画面上部の帯に出す。**新しく `localStorage.setItem` を直接呼ばない。**

## 日付

- **`new Date().toISOString().slice(0, 10)` を使わない。** UTC なので JST では朝9時までが前日になり、「今日やること」が深夜に消える。
- 日付は `src/lib/date.ts` のヘルパーを通す。`Date.now() + 86_400_000` のような素朴な加算も使わない。
- リポジトリのパスに日本語（`副業`）が含まれる。Node スクリプトで `import.meta.url` からパスを作るときは、`URL.pathname` ではなく `fileURLToPath()` を使う。

## 対話フェーズ

- **`PHASE_INSTRUCTIONS` に手順を足したら、`PHASE_TURN_LIMIT` も必ず見直す。** 上限に当たると、足した手順が一度も実行されないまま強制遷移する。型でもテストでも捕まらない。
- 各フェーズの最初のアシスタント発言が、ユーザー未回答のまま1ターンを消費する。「1回答えたら進んでよい」は `min = 2`。

## テスト

`npm test` で全部走る。新しい純粋関数を書いたら `tests/` に足すこと。
