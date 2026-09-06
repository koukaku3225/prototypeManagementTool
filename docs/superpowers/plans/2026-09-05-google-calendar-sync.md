# Googleカレンダー双方向同期 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** タイムボックスとGoogleカレンダー（アプリが作った専用カレンダー）を、タイトルと時間だけ双方向に同期する。

**Architecture:** ログインとは切り離した自前OAuthで `refresh_token` を取得し `google_calendar_links` に保管する。同期の判断は純粋関数 `decideCalendarAction()` に閉じ込め、I/Oと分離して全組み合わせをテストする。同期はアプリを開いたときにサーバー側のAPIルートで実行し、結果をブラウザが localStorage に書き戻す。

**Tech Stack:** Next.js (App Router) / TypeScript / Supabase (Postgres + RLS) / Google Calendar API v3 / zod / tsx（テスト）

**Spec:** `docs/superpowers/specs/2026-09-05-google-calendar-sync-design.md`

## Global Constraints

- 同期してよいフィールドは `title` / `start` / `end` の3つのみ。`meta` / `review` / `cardId` / `color` はカレンダー由来の値で**絶対に**書き換えない。
- スコープは `https://www.googleapis.com/auth/calendar.app.created` のみ。
- 新しいAPIルートは先頭で `requireAuthIfEnabled()` を呼び、`export const maxDuration` を明示する（AGENTS.md）。
- APIルートの入力は `src/lib/api-schema.ts` の zod スキーマを通す（AGENTS.md）。
- `NEXT_PUBLIC_` 接頭辞に鍵を置かない（AGENTS.md / `forbidden.test.mjs` が検査）。
- 日付は `src/lib/date.ts` のヘルパーを通す。`new Date().toISOString().slice(0,10)` を使わない（AGENTS.md）。
- 新しい純粋関数を書いたら `tests/` に足し、`package.json` の `test` に登録する（AGENTS.md）。
- Supabase にテーブル/列を足したら `mappers.ts` に対応を足す（AGENTS.md）。
- 同期する範囲は 過去7日 〜 未来60日。
- 1回の同期で削除が **5件** を超えたら実行せず確認を返す。

## File Structure

**新規作成**

| ファイル | 責務 |
|---|---|
| `src/lib/calendar/decide.ts` | 同期の判断（純粋関数）。I/Oを持たない |
| `src/lib/calendar/google.ts` | Google API の薄いラッパ |
| `src/lib/calendar/link.ts` | `google_calendar_links` の読み書き |
| `src/lib/calendar/engine.ts` | 同期本体。判断に従って API を呼ぶ |
| `src/app/api/calendar/connect/route.ts` | Googleへ送り出す |
| `src/app/api/calendar/callback/route.ts` | 戻り。トークン保存＋カレンダー作成 |
| `src/app/api/calendar/sync/route.ts` | 同期の実行 |
| `src/app/api/calendar/status/route.ts` | 連携状態の取得 |
| `src/app/api/calendar/disconnect/route.ts` | 連携解除 |
| `src/components/CalendarLink.tsx` | 設定画面の連携UI |
| `src/components/CalendarSyncBoot.tsx` | 時間割を開いたときの同期起動 |
| `tests/calendar-decide.test.mjs` | 判断表の総当たり |

**変更**

| ファイル | 変更内容 |
|---|---|
| `src/types/timebox.ts` | `googleEventId` / `updatedAt` を追加 |
| `src/lib/storage.ts` | `upsertTimeBox()` で `updatedAt` を刻む |
| `src/lib/supabase/mappers.ts` | 2列の対応を追加 |
| `src/lib/api-schema.ts` | `CalendarSyncRequestSchema` を追加 |
| `src/app/settings/page.tsx` | 連携セクションを差し込む |
| `src/app/plan/page.tsx` | 開いたときに同期を起動 |
| `tests/forbidden.test.mjs` | 構造ガードを追加 |
| `package.json` | 新テストを登録 |

---

### Task 1: 同期の判断表（純粋関数）

外部依存ゼロ。全体の心臓部で、先日の事故（表の一部しか実装していなかった）を繰り返さないための土台。

**Files:**
- Create: `src/lib/calendar/decide.ts`
- Create: `tests/calendar-decide.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: なし
- Produces: `decideCalendarAction(i: CalendarSyncInputs): CalendarAction`、型 `CalendarSyncInputs` / `CalendarAction`

- [ ] **Step 1: 失敗するテストを書く**

`tests/calendar-decide.test.mjs`:

```js
/**
 * 同期の判断を組み合わせで総当たりする。
 *
 * クラウド同期で「表の2マスしか実装していない」ことに気づけず、
 * 本番でデータが出てこない・消えかける、という2つの事故を出した。
 * 判断をI/Oから切り離してあるので、ここで全パターンを固定できる。
 * 実行は `npm test`。
 */
import assert from "node:assert/strict";
import { decideCalendarAction } from "../src/lib/calendar/decide.ts";

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}

/** 既定値。各テストは必要な軸だけ上書きする */
function inputs(over) {
  return {
    boxExists: false,
    boxIsGhost: false,
    boxHasNotes: false,
    boxUpdatedAt: null,
    eventState: "missing",
    eventHasMark: false,
    eventUpdated: null,
    contentEqual: false,
    ...over,
  };
}

t("#1 アプリにあり、カレンダーに無い → カレンダーに作る", () => {
  assert.equal(
    decideCalendarAction(inputs({ boxExists: true, eventState: "missing" })),
    "createEvent",
  );
});

t("#2a 両方あり、アプリ側が新しい → カレンダーを更新", () => {
  assert.equal(
    decideCalendarAction(
      inputs({
        boxExists: true,
        eventState: "present",
        eventHasMark: true,
        boxUpdatedAt: "2026-09-05T10:00:00.000Z",
        eventUpdated: "2026-09-05T09:00:00.000Z",
      }),
    ),
    "updateEvent",
  );
});

t("#2b 両方あり、カレンダー側が新しい → アプリを更新", () => {
  assert.equal(
    decideCalendarAction(
      inputs({
        boxExists: true,
        eventState: "present",
        eventHasMark: true,
        boxUpdatedAt: "2026-09-05T09:00:00.000Z",
        eventUpdated: "2026-09-05T10:00:00.000Z",
      }),
    ),
    "updateBox",
  );
});

t("#2c 両方あり、中身が同じ → 何もしない", () => {
  assert.equal(
    decideCalendarAction(
      inputs({
        boxExists: true,
        eventState: "present",
        eventHasMark: true,
        contentEqual: true,
        boxUpdatedAt: "2026-09-05T09:00:00.000Z",
        eventUpdated: "2026-09-05T10:00:00.000Z",
      }),
    ),
    "none",
  );
});

t("#2d 同点ならアプリ側を優先する", () => {
  // アプリ側の変更は必ず意図的な操作。カレンダーの updated は他の要因でも動く
  assert.equal(
    decideCalendarAction(
      inputs({
        boxExists: true,
        eventState: "present",
        eventHasMark: true,
        boxUpdatedAt: "2026-09-05T10:00:00.000Z",
        eventUpdated: "2026-09-05T10:00:00.000Z",
      }),
    ),
    "updateEvent",
  );
});

t("#3a カレンダーで削除され、書き込みが無い → アプリからも消す", () => {
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: true, eventState: "cancelled", boxHasNotes: false }),
    ),
    "deleteBox",
  );
});

t("#3b カレンダーで削除されたが、振り返り等がある → 残す", () => {
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: true, eventState: "cancelled", boxHasNotes: true }),
    ),
    "keepBox",
  );
});

t("#4 アプリに無く、印のある予定 → アプリで消された。カレンダーからも消す", () => {
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: false, eventState: "present", eventHasMark: true }),
    ),
    "deleteEvent",
  );
});

t("#5 アプリに無く、印の無い予定 → カレンダーで作られた。取り込む", () => {
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: false, eventState: "present", eventHasMark: false }),
    ),
    "importBox",
  );
});

t("#6 アプリに無く、カレンダーでも削除済み → 何もしない", () => {
  assert.equal(
    decideCalendarAction(inputs({ boxExists: false, eventState: "cancelled" })),
    "none",
  );
});

t("#7 習慣由来の枠は同期しない", () => {
  // 実体を持たず毎回作り直されるので、書くと削除が走り続ける
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: true, boxIsGhost: true, eventState: "missing" }),
    ),
    "none",
  );
});

t("【不変条件1】書き込みのある枠を、決して消さない", () => {
  for (const eventState of ["missing", "present", "cancelled"]) {
    for (const eventHasMark of [true, false]) {
      const d = decideCalendarAction(
        inputs({ boxExists: true, boxHasNotes: true, eventState, eventHasMark }),
      );
      assert.notEqual(d, "deleteBox", `${eventState}/${eventHasMark} で deleteBox`);
    }
  }
});

t("【不変条件2】印の無い予定を、決して削除しない", () => {
  // 印が無い ＝ カレンダー側で人が作ったもの。うちが消してよいものではない
  for (const boxExists of [true, false]) {
    const d = decideCalendarAction(
      inputs({ boxExists, eventState: "present", eventHasMark: false }),
    );
    assert.notEqual(d, "deleteEvent", `boxExists=${boxExists} で deleteEvent`);
  }
});

t("【不変条件3】習慣由来の枠は、どの組み合わせでも none", () => {
  for (const eventState of ["missing", "present", "cancelled"]) {
    for (const boxHasNotes of [true, false]) {
      assert.equal(
        decideCalendarAction(
          inputs({ boxExists: true, boxIsGhost: true, eventState, boxHasNotes }),
        ),
        "none",
      );
    }
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `npx tsx tests/calendar-decide.test.mjs`
Expected: FAIL（`src/lib/calendar/decide.ts` が無く import エラー）

- [ ] **Step 3: 実装を書く**

`src/lib/calendar/decide.ts`:

```ts
/**
 * カレンダー同期の判断だけを、外部依存なしで切り出したもの。
 *
 * クラウド同期のとき「判断とI/Oを混ぜたせいで組み合わせを全部試せず、
 * 表の一部しか実装していないことに気づけなかった」という失敗をしている。
 * ここは純粋関数にして総当たりできる形にする。
 */

export type CalendarAction =
  /** アプリの枠をカレンダーに作る */
  | "createEvent"
  /** カレンダー側の予定を、アプリの内容で更新する */
  | "updateEvent"
  /** アプリの枠を、カレンダーの内容で更新する（title/start/end のみ） */
  | "updateBox"
  /** カレンダーから予定を消す */
  | "deleteEvent"
  /** アプリから枠を消す */
  | "deleteBox"
  /** カレンダーでは消されたが、書き込みがあるのでアプリには残す */
  | "keepBox"
  /** カレンダーで作られた予定を、アプリに取り込む */
  | "importBox"
  | "none";

export interface CalendarSyncInputs {
  /** アプリ側にこの枠があるか */
  boxExists: boolean;
  /** 習慣から自動で並んでいる仮の枠か（id が "habit-" で始まる） */
  boxIsGhost: boolean;
  /** meta か review に何か書かれているか。消してよいかの判断に使う */
  boxHasNotes: boolean;
  /** TimeBox.updatedAt。古いデータには無いので null を許す */
  boxUpdatedAt: string | null;
  /** カレンダー側の状態。cancelled は「削除された」 */
  eventState: "missing" | "present" | "cancelled";
  /** extendedProperties.private.timeboxId が付いているか（＝うちが作った予定か） */
  eventHasMark: boolean;
  /** Google の event.updated（RFC3339） */
  eventUpdated: string | null;
  /** タイトルと時間が完全に一致しているか */
  contentEqual: boolean;
}

/**
 * 守る不変条件は3つ。
 *
 *   1. 書き込み（メタ認知・振り返り）のある枠を、自動で消さない。
 *      カレンダーは title/start/end しか持たないので、
 *      カレンダーを根拠にそれ以外を失わせてはならない。
 *   2. 印の無い予定を消さない。印が無い ＝ 人がカレンダーで作ったもの。
 *   3. 習慣由来の仮の枠は同期しない（毎回作り直されるため）。
 */
export function decideCalendarAction(i: CalendarSyncInputs): CalendarAction {
  // 3. 習慣由来は何があっても触らない
  if (i.boxIsGhost) return "none";

  if (i.boxExists) {
    if (i.eventState === "missing") return "createEvent";

    if (i.eventState === "cancelled") {
      // 1. 書いたものがあるなら残す。カレンダーの削除だけで失わせない
      return i.boxHasNotes ? "keepBox" : "deleteBox";
    }

    // 両方にある
    if (i.contentEqual) return "none";
    // 同点はアプリ側を優先する（アプリ側の変更は必ず意図的な操作）
    const boxAt = i.boxUpdatedAt ?? "";
    const evAt = i.eventUpdated ?? "";
    return evAt > boxAt ? "updateBox" : "updateEvent";
  }

  // アプリ側に無い
  if (i.eventState !== "present") return "none";
  // 2. 印があればうちが作ったもの＝アプリで消された。無ければ人が作ったもの
  return i.eventHasMark ? "deleteEvent" : "importBox";
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx tsx tests/calendar-decide.test.mjs`
Expected: PASS（14 passed, 0 failed）

- [ ] **Step 5: `package.json` に登録して全体を走らせる**

`test` スクリプト内の `tsx tests/sync-decision.test.mjs &&` の直後に
`tsx tests/calendar-decide.test.mjs &&` を挿入する。

Run: `npm test`
Expected: 全て PASS

- [ ] **Step 6: コミット**

```bash
git add src/lib/calendar/decide.ts tests/calendar-decide.test.mjs package.json
git commit -m "feat: カレンダー同期の判断を純粋関数にし、組み合わせを総当たりする"
```

---

### Task 2: TimeBox に `updatedAt` と `googleEventId` を足す

**Files:**
- Modify: `src/types/timebox.ts`
- Modify: `src/lib/storage.ts`（`upsertTimeBox`）
- Modify: `src/lib/supabase/mappers.ts`
- Modify: `tests/storage.test.mjs`
- Supabase: `timeboxes` に2列追加

**Interfaces:**
- Consumes: なし
- Produces: `TimeBox.updatedAt?: string`、`TimeBox.googleEventId?: string | null`

- [ ] **Step 1: 失敗するテストを書く**

`tests/storage.test.mjs` の末尾（`console.log` の直前）に追加:

```js
t("upsertTimeBox は updatedAt を刻む", () => {
  reset();
  const before = new Date().toISOString();
  S.upsertTimeBox({
    id: "tb-1",
    date: "2026-09-05",
    start: "10:00",
    end: "10:30",
    title: "テスト",
    cardId: null,
    meta: { why: "", obstacle: "", counter: "" },
    completedAt: null,
    review: null,
    createdAt: before,
  });
  const saved = S.loadTimeBoxes().find((b) => b.id === "tb-1");
  assert.ok(saved.updatedAt, "updatedAt が入っていない");
  assert.ok(saved.updatedAt >= before, "updatedAt が古すぎる");
});

t("upsertTimeBox は呼ぶたびに updatedAt を更新する", () => {
  // 「どちらが新しいか」の判断に使うので、更新のたびに動かないと意味がない
  reset();
  S.upsertTimeBox({
    id: "tb-2",
    date: "2026-09-05",
    start: "10:00",
    end: "10:30",
    title: "一回目",
    cardId: null,
    meta: { why: "", obstacle: "", counter: "" },
    completedAt: null,
    review: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  const saved = S.loadTimeBoxes().find((b) => b.id === "tb-2");
  assert.notEqual(saved.updatedAt, "2026-09-01T00:00:00.000Z", "更新されていない");
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx tsx tests/storage.test.mjs`
Expected: FAIL（`updatedAt が入っていない`）

- [ ] **Step 3: 型に2つ足す**

`src/types/timebox.ts` の `TimeBox` の `createdAt: string;` の直前に挿入:

```ts
  /**
   * カレンダー側のイベントID。連携していない・まだ送っていない枠は null。
   * これで「アプリの枠」と「カレンダーの予定」を突き合わせる。
   */
  googleEventId?: string | null;
  /**
   * 最後に触った時刻（ISO8601）。
   *
   * カレンダーと双方向に同期するとき「どちらが新しいか」を決める材料。
   * createdAt しか無いと、両方で編集されたときに judgement ができない。
   * upsertTimeBox() が必ず刻むので、呼び出し側は気にしなくてよい。
   */
  updatedAt?: string;
```

- [ ] **Step 4: `upsertTimeBox` で刻む**

`src/lib/storage.ts` の `upsertTimeBox` を差し替える:

```ts
export function upsertTimeBox(b: TimeBox): void {
  const all = loadTimeBoxes();
  // 保存のたびに更新時刻を刻む。書き込みが必ずここを通るので、
  // 呼び出し側で付け忘れることがない（カレンダー同期の突き合わせに使う）
  const stamped: TimeBox = { ...b, updatedAt: new Date().toISOString() };
  const i = all.findIndex((x) => x.id === b.id);
  if (i >= 0) all[i] = stamped;
  else all.push(stamped);
  write(KEY.timeboxes, all);
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx tsx tests/storage.test.mjs`
Expected: PASS

- [ ] **Step 6: Supabase に列を足す**

マイグレーション名 `add_calendar_columns_to_timeboxes`:

```sql
ALTER TABLE timeboxes ADD COLUMN IF NOT EXISTS google_event_id text;
ALTER TABLE timeboxes ADD COLUMN IF NOT EXISTS updated_at timestamptz;
```

- [ ] **Step 7: mappers に対応を足す**

`src/lib/supabase/mappers.ts` の `timeBoxToRow` の `created_at: b.createdAt,` の直前に追加:

```ts
    google_event_id: b.googleEventId ?? null,
    updated_at: b.updatedAt ?? null,
```

`timeBoxFromRow` の `createdAt: r.created_at as string,` の直前に追加:

```ts
    googleEventId: (r.google_event_id as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? undefined,
```

- [ ] **Step 8: 型チェックとテスト**

Run: `npx tsc --noEmit && npm test`
Expected: 全て PASS

- [ ] **Step 9: コミット**

```bash
git add src/types/timebox.ts src/lib/storage.ts src/lib/supabase/mappers.ts tests/storage.test.mjs
git commit -m "feat: TimeBox に updatedAt と googleEventId を足す"
```

---

### Task 3: 連携情報の保管（`google_calendar_links`）

**Files:**
- Create: `src/lib/calendar/link.ts`
- Supabase: `google_calendar_links` テーブル作成

**Interfaces:**
- Consumes: `supabaseServer()`（`src/lib/supabase/server.ts`）
- Produces: `loadLink()`、`saveLink()`、`updateLink()`、`deleteLink()`、型 `CalendarLink`

- [ ] **Step 1: テーブルを作る**

マイグレーション名 `create_google_calendar_links`:

```sql
create table if not exists google_calendar_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  calendar_id text not null,
  sync_token text,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error text
);

alter table google_calendar_links enable row level security;

-- 他の8テーブルと同じ形。本人の行だけ触れる
create policy "own rows only" on google_calendar_links
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
```

- [ ] **Step 2: RLSが効いていることを確認**

```sql
select tablename, rowsecurity from pg_tables where tablename = 'google_calendar_links';
select policyname, cmd from pg_policies where tablename = 'google_calendar_links';
```
Expected: `rowsecurity = true`、`own rows only / ALL` が1件

- [ ] **Step 3: 読み書きを書く**

`src/lib/calendar/link.ts`:

```ts
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Googleカレンダー連携の状態。サーバー側からだけ触る。
 *
 * refresh_token を持つのでブラウザには返さない。
 * スコープを calendar.app.created に絞ってあるため、万一漏れても
 * 露出するのはアプリが作った専用カレンダー（＝アプリが既に持つ情報）だけ。
 */
export interface CalendarLink {
  userId: string;
  refreshToken: string;
  calendarId: string;
  syncToken: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/** ログイン中のユーザーの連携情報。未連携なら null */
export async function loadLink(): Promise<CalendarLink | null> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("google_calendar_links")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return null;

  return {
    userId: data.user_id as string,
    refreshToken: data.refresh_token as string,
    calendarId: data.calendar_id as string,
    syncToken: (data.sync_token as string | null) ?? null,
    lastSyncedAt: (data.last_synced_at as string | null) ?? null,
    lastError: (data.last_error as string | null) ?? null,
  };
}

/** 連携を作る／作り直す */
export async function saveLink(v: {
  refreshToken: string;
  calendarId: string;
}): Promise<boolean> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase.from("google_calendar_links").upsert({
    user_id: user.id,
    refresh_token: v.refreshToken,
    calendar_id: v.calendarId,
    sync_token: null,
    connected_at: new Date().toISOString(),
    last_error: null,
  });
  return !error;
}

/** 同期のあとで状態だけ更新する */
export async function updateLink(v: {
  syncToken?: string | null;
  lastSyncedAt?: string;
  lastError?: string | null;
}): Promise<void> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const patch: Record<string, unknown> = {};
  if (v.syncToken !== undefined) patch.sync_token = v.syncToken;
  if (v.lastSyncedAt !== undefined) patch.last_synced_at = v.lastSyncedAt;
  if (v.lastError !== undefined) patch.last_error = v.lastError;
  if (Object.keys(patch).length === 0) return;

  await supabase.from("google_calendar_links").update(patch).eq("user_id", user.id);
}

/**
 * 連携を解除する。
 * カレンダー側の予定は消さない —— 消すと取り返しがつかないので、
 * 残して本人に判断してもらう。
 */
export async function deleteLink(): Promise<void> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("google_calendar_links").delete().eq("user_id", user.id);
}
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/lib/calendar/link.ts
git commit -m "feat: Googleカレンダー連携情報の保管を足す"
```

---

### Task 4: Google API の薄いラッパ

**Files:**
- Create: `src/lib/calendar/google.ts`

**Interfaces:**
- Consumes: 環境変数 `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
- Produces: `CALENDAR_SCOPE`、`exchangeCode()`、`refreshAccessToken()`、`createCalendar()`、`listEvents()`、`insertEvent()`、`patchEvent()`、`deleteEvent()`、型 `GoogleEvent`

- [ ] **Step 1: 実装を書く**

`src/lib/calendar/google.ts`:

```ts
/**
 * Google Calendar API の薄いラッパ。
 *
 * 公式SDKを入れず fetch で書くのは、使うのが数エンドポイントだけで、
 * 依存を1つ増やすほどの分量ではないため。
 *
 * スコープは calendar.app.created のみ。これは「このアプリが作成した
 * カレンダー」だけを対象にする権限で、本人のメインカレンダーには
 * 構造上アクセスできない。万一トークンが漏れたときの被害を、
 * アプリが既に持っている情報の範囲に閉じ込めるための選択。
 */

export const CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.app.created";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

function creds() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / _SECRET が設定されていません");
  }
  return { id, secret };
}

/** 認可コードを refresh_token に交換する（連携の初回だけ） */
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string }> {
  const { id, secret } = creds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`トークン交換に失敗しました (${res.status})`);
  const j = (await res.json()) as { refresh_token?: string; access_token?: string };
  if (!j.refresh_token) {
    // access_type=offline と prompt=consent が付いていないと起きる
    throw new Error("refresh_token が返りませんでした");
  }
  return { refreshToken: j.refresh_token, accessToken: j.access_token ?? "" };
}

/**
 * refresh_token から access_token を取り直す。
 * access_token は約1時間で切れるので保存せず、使う直前に毎回取る。
 */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { id, secret } = creds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: id,
      client_secret: secret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`アクセストークンを更新できませんでした (${res.status})`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("access_token が返りませんでした");
  return j.access_token;
}

async function call(token: string, path: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

/** 専用カレンダーを作る。連携の初回だけ */
export async function createCalendar(token: string, summary: string): Promise<string> {
  const res = await call(token, "/calendars", {
    method: "POST",
    body: JSON.stringify({ summary, timeZone: "Asia/Tokyo" }),
  });
  if (!res.ok) throw new Error(`カレンダーを作成できませんでした (${res.status})`);
  const j = (await res.json()) as { id?: string };
  if (!j.id) throw new Error("カレンダーIDが返りませんでした");
  return j.id;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * 予定を取る。
 *
 * syncToken があれば前回からの差分だけ返る（削除も status:"cancelled" で来る）。
 * 期限切れ（410）のときは全件取り直しが要るので、その旨を返す。
 */
export async function listEvents(
  token: string,
  calendarId: string,
  opts: { syncToken?: string | null; timeMin?: string; timeMax?: string },
): Promise<
  | { ok: true; events: GoogleEvent[]; nextSyncToken: string | null }
  | { ok: false; needsFullSync: true }
> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  do {
    const q = new URLSearchParams({ maxResults: "250", showDeleted: "true" });
    if (opts.syncToken) q.set("syncToken", opts.syncToken);
    else {
      // 初回は範囲を切る。全期間を取ると呼び出し回数が読めない
      if (opts.timeMin) q.set("timeMin", opts.timeMin);
      if (opts.timeMax) q.set("timeMax", opts.timeMax);
      q.set("singleEvents", "true");
    }
    if (pageToken) q.set("pageToken", pageToken);

    const res = await call(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events?${q}`,
    );
    // 410 = syncToken が古すぎる。Googleの想定動作なので全件取り直しへ倒す
    if (res.status === 410) return { ok: false, needsFullSync: true };
    if (!res.ok) throw new Error(`予定を取得できませんでした (${res.status})`);

    const j = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    events.push(...(j.items ?? []));
    pageToken = j.nextPageToken;
    nextSyncToken = j.nextSyncToken ?? nextSyncToken;
  } while (pageToken);

  return { ok: true, events, nextSyncToken };
}

/** アプリの枠から作る予定の本体。印（timeboxId）を必ず入れる */
function eventBody(v: {
  title: string;
  startIso: string;
  endIso: string;
  timeboxId: string;
}) {
  return {
    summary: v.title || "（未記入）",
    start: { dateTime: v.startIso, timeZone: "Asia/Tokyo" },
    end: { dateTime: v.endIso, timeZone: "Asia/Tokyo" },
    // この印があることで「アプリで消された予定」と
    // 「カレンダーで新しく作られた予定」を区別できる
    extendedProperties: { private: { timeboxId: v.timeboxId } },
  };
}

export async function insertEvent(
  token: string,
  calendarId: string,
  v: { title: string; startIso: string; endIso: string; timeboxId: string },
): Promise<string> {
  const res = await call(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    body: JSON.stringify(eventBody(v)),
  });
  if (!res.ok) throw new Error(`予定を作成できませんでした (${res.status})`);
  const j = (await res.json()) as { id?: string };
  if (!j.id) throw new Error("イベントIDが返りませんでした");
  return j.id;
}

export async function patchEvent(
  token: string,
  calendarId: string,
  eventId: string,
  v: { title: string; startIso: string; endIso: string; timeboxId: string },
): Promise<void> {
  const res = await call(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body: JSON.stringify(eventBody(v)) },
  );
  if (!res.ok) throw new Error(`予定を更新できませんでした (${res.status})`);
}

export async function deleteEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const res = await call(
    token,
    `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
  // 410/404 は「すでに消えている」。目的は達成されているので成功扱い
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`予定を削除できませんでした (${res.status})`);
  }
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/lib/calendar/google.ts
git commit -m "feat: Google Calendar API の薄いラッパを足す"
```

---

### Task 5: OAuth の往復（connect / callback）

**Files:**
- Create: `src/app/api/calendar/connect/route.ts`
- Create: `src/app/api/calendar/callback/route.ts`

**Interfaces:**
- Consumes: Task 3 `saveLink()`、Task 4 `CALENDAR_SCOPE` / `exchangeCode()` / `refreshAccessToken()` / `createCalendar()`
- Produces: `GET /api/calendar/connect`、`GET /api/calendar/callback`、`STATE_COOKIE`

- [ ] **Step 1: connect を書く**

`src/app/api/calendar/connect/route.ts`:

```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { CALENDAR_SCOPE } from "@/lib/calendar/google";

export const runtime = "nodejs";
export const maxDuration = 10;

/** state の置き場所。戻ってきたときに突き合わせる（CSRF対策） */
export const STATE_COOKIE = "gc_oauth_state";

export async function GET(req: Request) {
  const denied = await requireAuthIfEnabled();
  if (denied) return denied;

  const origin = new URL(req.url).origin;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/settings?calendar=misconfigured", origin));
  }

  // 戻ってきたときに「自分が始めた往復か」を確かめるための合言葉
  const state = crypto.randomUUID();
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/calendar/callback`,
    response_type: "code",
    scope: CALENDAR_SCOPE,
    // refresh_token をもらうために必須。無いと1時間で切れて終わる
    access_type: "offline",
    // 2回目以降の連携でも確実に refresh_token を返させる
    prompt: "consent",
    state,
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}
```

- [ ] **Step 2: callback を書く**

`src/app/api/calendar/callback/route.ts`:

```ts
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { createCalendar, exchangeCode, refreshAccessToken } from "@/lib/calendar/google";
import { saveLink } from "@/lib/calendar/link";
import { STATE_COOKIE } from "../connect/route";

export const runtime = "nodejs";
export const maxDuration = 30;

/** 専用カレンダーの名前。ユーザーのカレンダー一覧にこの名前で並ぶ */
const CALENDAR_NAME = "目標設定コーチ";

export async function GET(req: Request) {
  const denied = await requireAuthIfEnabled();
  if (denied) return denied;

  const url = new URL(req.url);
  const origin = url.origin;
  const fail = (why: string) =>
    NextResponse.redirect(new URL(`/settings?calendar=${why}`, origin));

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  // 使い捨て。成否にかかわらず消す
  jar.delete(STATE_COOKIE);

  // 合言葉が一致しないものは、自分が始めた往復ではない
  if (!state || !expected || state !== expected) return fail("state");
  if (!code) return fail("denied");

  try {
    const { refreshToken } = await exchangeCode(code, `${origin}/api/calendar/callback`);
    const accessToken = await refreshAccessToken(refreshToken);
    const calendarId = await createCalendar(accessToken, CALENDAR_NAME);
    const ok = await saveLink({ refreshToken, calendarId });
    if (!ok) return fail("save");
    return NextResponse.redirect(new URL("/settings?calendar=connected", origin));
  } catch (err) {
    console.error("[calendar/callback]", err);
    return fail("error");
  }
}
```

- [ ] **Step 3: 型チェックとテスト**

Run: `npx tsc --noEmit && npm test`
Expected: 全て PASS

- [ ] **Step 4: 実際に連携を通す**

Run: `npm run dev` して `http://localhost:3000/api/calendar/connect` を開く
Expected: Googleの同意画面 →「許可」→ `/settings?calendar=connected` に戻る

確認1: Googleカレンダーに「目標設定コーチ」が増えていること
確認2: `select calendar_id from google_calendar_links;` に行があること

- [ ] **Step 5: コミット**

```bash
git add src/app/api/calendar/connect/route.ts src/app/api/calendar/callback/route.ts
git commit -m "feat: Googleカレンダー連携のOAuth往復を足す"
```

---

### Task 6: 同期エンジンと `/api/calendar/sync`

同期はサーバー側で判断し、**アプリ側に反映すべき結果を返す**。localStorage はブラウザにしか無いので、ブラウザが受け取って書き戻す。

**Files:**
- Create: `src/lib/calendar/engine.ts`
- Create: `src/app/api/calendar/sync/route.ts`
- Modify: `src/lib/api-schema.ts`

**Interfaces:**
- Consumes: Task 1 `decideCalendarAction()`、Task 3 `loadLink()`/`updateLink()`、Task 4 の全関数、`addDays()`（`src/lib/date.ts`）
- Produces: `runSync(boxes, confirmDeletes)`、`DELETE_BRAKE`、型 `SyncBoxInput` / `SyncResult`、`POST /api/calendar/sync`

- [ ] **Step 1: 入力スキーマを足す**

`src/lib/api-schema.ts` の末尾に追加:

```ts
/** カレンダー同期。ブラウザが持っている枠をそのまま送って突き合わせる */
export const CalendarSyncRequestSchema = z.object({
  boxes: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        date: z.string().max(10),
        start: z.string().max(5),
        end: z.string().max(5),
        title: z.string().max(300),
        googleEventId: z.string().max(1024).nullable().optional(),
        updatedAt: z.string().max(40).optional(),
        hasNotes: z.boolean(),
      }),
    )
    .max(2000),
  /** 削除の確認を本人が押したか。ブレーキを解除する */
  confirmDeletes: z.boolean().optional(),
});
```

- [ ] **Step 2: エンジンを書く**

`src/lib/calendar/engine.ts`:

```ts
import { addDays } from "@/lib/date";
import { decideCalendarAction } from "./decide";
import {
  deleteEvent,
  insertEvent,
  listEvents,
  patchEvent,
  refreshAccessToken,
  type GoogleEvent,
} from "./google";
import { loadLink, updateLink } from "./link";

/** 1回の同期で許す削除の上限。超えたら止めて本人に確認する */
export const DELETE_BRAKE = 5;

/** ブラウザから送られてくる枠の最小形 */
export interface SyncBoxInput {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  googleEventId?: string | null;
  updatedAt?: string;
  hasNotes: boolean;
}

/** ブラウザに返す指示 */
export interface SyncResult {
  /** 内容を書き換える枠（title/start/end/date と googleEventId のみ） */
  upserts: {
    id: string;
    title?: string;
    date?: string;
    start?: string;
    end?: string;
    googleEventId?: string | null;
  }[];
  /** 新しく取り込む枠 */
  imports: {
    title: string;
    date: string;
    start: string;
    end: string;
    googleEventId: string;
  }[];
  /** 消す枠のid */
  deletes: string[];
  /** ブレーキが働いた場合の件数。0 なら通常どおり実行済み */
  pendingDeletes: number;
}

const isGhostId = (id: string) => id.startsWith("habit-");

/** "2026-09-05" + "10:00" → RFC3339（JST固定） */
export function toRfc3339(date: string, time: string): string {
  return `${date}T${time}:00+09:00`;
}

/** RFC3339 → ローカル表現。終日予定（date のみ）は対象外なので null */
export function fromRfc3339(
  dt: { dateTime?: string; date?: string } | undefined,
): { date: string; time: string } | null {
  if (!dt?.dateTime) return null;
  const d = new Date(dt.dateTime);
  if (Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    time: `${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

const markOf = (e: GoogleEvent): string | null =>
  e.extendedProperties?.private?.timeboxId ?? null;

/**
 * 同期の本体。
 *
 * 判断は decide.ts に委ね、ここは「その判断どおりに動かす」ことに徹する。
 * 途中で失敗しても、そこまでの反映は残して次回で追いつく（全か無かにしない）。
 */
export async function runSync(
  boxes: SyncBoxInput[],
  confirmDeletes: boolean,
): Promise<{ ok: true; result: SyncResult } | { ok: false; message: string }> {
  const link = await loadLink();
  if (!link) return { ok: false, message: "連携していません。" };

  let token: string;
  try {
    token = await refreshAccessToken(link.refreshToken);
  } catch {
    await updateLink({ lastError: "トークンを更新できませんでした" });
    return { ok: false, message: "連携が切れています。設定から再連携してください。" };
  }

  const timeMin = toRfc3339(addDays(-7), "00:00");
  const timeMax = toRfc3339(addDays(60), "23:59");

  let listed = await listEvents(token, link.calendarId, {
    syncToken: link.syncToken,
    timeMin,
    timeMax,
  });
  if (!listed.ok) {
    // syncToken が失効。全件取り直し（Googleの想定動作）
    listed = await listEvents(token, link.calendarId, { timeMin, timeMax });
    if (!listed.ok) return { ok: false, message: "予定を取得できませんでした。" };
  }

  const events = listed.events;
  const byId = new Map(events.map((e) => [e.id, e]));
  const byMark = new Map<string, GoogleEvent>();
  for (const e of events) {
    const m = markOf(e);
    if (m) byMark.set(m, e);
  }
  const boxById = new Map(boxes.map((b) => [b.id, b]));
  const result: SyncResult = { upserts: [], imports: [], deletes: [], pendingDeletes: 0 };

  // --- まず削除の件数を数えてブレーキを判定する ---
  let deleteCount = 0;
  for (const b of boxes) {
    if (isGhostId(b.id)) continue;
    const e = b.googleEventId ? byId.get(b.googleEventId) : byMark.get(b.id);
    if (e && e.status === "cancelled" && !b.hasNotes) deleteCount++;
  }
  for (const e of events) {
    if (e.status === "cancelled") continue;
    const mark = markOf(e);
    if (mark && !boxById.has(mark)) deleteCount++;
  }
  if (deleteCount > DELETE_BRAKE && !confirmDeletes) {
    // 判定が壊れていたときに、1回で全滅させないための保険
    return { ok: true, result: { ...result, pendingDeletes: deleteCount } };
  }

  // --- アプリ側の枠を1件ずつ処理する ---
  for (const b of boxes) {
    const e = b.googleEventId ? byId.get(b.googleEventId) : byMark.get(b.id);
    const evStart = e ? fromRfc3339(e.start) : null;
    const evEnd = e ? fromRfc3339(e.end) : null;
    const contentEqual = Boolean(
      e &&
        (e.summary ?? "") === b.title &&
        evStart?.date === b.date &&
        evStart?.time === b.start &&
        evEnd?.time === b.end,
    );

    const action = decideCalendarAction({
      boxExists: true,
      boxIsGhost: isGhostId(b.id),
      boxHasNotes: b.hasNotes,
      boxUpdatedAt: b.updatedAt ?? null,
      eventState: !e ? "missing" : e.status === "cancelled" ? "cancelled" : "present",
      eventHasMark: Boolean(e && markOf(e)),
      eventUpdated: e?.updated ?? null,
      contentEqual,
    });

    try {
      if (action === "createEvent") {
        const id = await insertEvent(token, link.calendarId, {
          title: b.title,
          startIso: toRfc3339(b.date, b.start),
          endIso: toRfc3339(b.date, b.end),
          timeboxId: b.id,
        });
        result.upserts.push({ id: b.id, googleEventId: id });
      } else if (action === "updateEvent" && e) {
        await patchEvent(token, link.calendarId, e.id, {
          title: b.title,
          startIso: toRfc3339(b.date, b.start),
          endIso: toRfc3339(b.date, b.end),
          timeboxId: b.id,
        });
      } else if (action === "updateBox" && e && evStart && evEnd) {
        // カレンダーが持つのは title/start/end だけ。それ以外は絶対に触らない
        result.upserts.push({
          id: b.id,
          title: e.summary ?? "",
          date: evStart.date,
          start: evStart.time,
          end: evEnd.time,
        });
      } else if (action === "deleteBox") {
        result.deletes.push(b.id);
      }
      // keepBox / none は何もしない
    } catch (err) {
      // 1件の失敗で全体を止めない。次回の同期で追いつく
      console.error("[calendar/sync] box", b.id, err);
    }
  }

  // --- カレンダー側にしか無い予定を処理する ---
  for (const e of events) {
    const mark = markOf(e);
    if (mark && boxById.has(mark)) continue; // 上のループで見た
    const action = decideCalendarAction({
      boxExists: false,
      boxIsGhost: false,
      boxHasNotes: false,
      boxUpdatedAt: null,
      eventState: e.status === "cancelled" ? "cancelled" : "present",
      eventHasMark: Boolean(mark),
      eventUpdated: e.updated ?? null,
      contentEqual: false,
    });

    try {
      if (action === "deleteEvent") {
        await deleteEvent(token, link.calendarId, e.id);
      } else if (action === "importBox") {
        const s = fromRfc3339(e.start);
        const en = fromRfc3339(e.end);
        if (!s || !en) continue; // 終日予定は時間割に載らない
        result.imports.push({
          title: e.summary ?? "",
          date: s.date,
          start: s.time,
          end: en.time,
          googleEventId: e.id,
        });
      }
    } catch (err) {
      console.error("[calendar/sync] event", e.id, err);
    }
  }

  await updateLink({
    syncToken: listed.nextSyncToken,
    lastSyncedAt: new Date().toISOString(),
    lastError: null,
  });
  return { ok: true, result };
}
```

- [ ] **Step 3: APIルートを書く**

`src/app/api/calendar/sync/route.ts`:

```ts
import { CalendarSyncRequestSchema, parseBody } from "@/lib/api-schema";
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { runSync } from "@/lib/calendar/engine";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = await requireAuthIfEnabled();
  if (denied) return denied;

  const parsed = await parseBody(req, CalendarSyncRequestSchema);
  if (!parsed.ok) {
    return Response.json(
      { ok: false, message: "不正な入力です。" },
      { status: parsed.status },
    );
  }

  try {
    const r = await runSync(parsed.data.boxes, parsed.data.confirmDeletes ?? false);
    return Response.json(r.ok ? { ok: true, ...r.result } : r);
  } catch (err) {
    /*
     * カレンダー同期は付加機能であって、時間割そのものではない。
     * 例外を投げっぱなしにすると500になり、呼び出し側の画面まで巻き込む。
     * レート制限で同じ穴を踏んだので、必ず ok:false で返す。
     */
    console.error("[calendar/sync]", err);
    return Response.json({
      ok: false,
      message: "同期できませんでした。時間をおいて試してください。",
    });
  }
}
```

- [ ] **Step 4: 型チェックとテスト**

Run: `npx tsc --noEmit && npm test`
Expected: 全て PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/calendar/engine.ts src/app/api/calendar/sync/route.ts src/lib/api-schema.ts
git commit -m "feat: カレンダー同期のエンジンとAPIルートを足す"
```

---

### Task 7: 設定画面の連携UI

**Files:**
- Create: `src/components/CalendarLink.tsx`
- Create: `src/app/api/calendar/status/route.ts`
- Create: `src/app/api/calendar/disconnect/route.ts`
- Modify: `src/app/settings/page.tsx`

**Interfaces:**
- Consumes: Task 3 `loadLink()` / `deleteLink()`
- Produces: `<CalendarLink />`、`GET /api/calendar/status`、`POST /api/calendar/disconnect`

- [ ] **Step 1: 状態と解除のルートを書く**

`src/app/api/calendar/status/route.ts`:

```ts
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { loadLink } from "@/lib/calendar/link";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET() {
  const denied = await requireAuthIfEnabled();
  if (denied) return denied;
  const link = await loadLink();
  // refresh_token は絶対に返さない
  return Response.json({
    connected: Boolean(link),
    lastSyncedAt: link?.lastSyncedAt ?? null,
    lastError: link?.lastError ?? null,
  });
}
```

`src/app/api/calendar/disconnect/route.ts`:

```ts
import { requireAuthIfEnabled } from "@/lib/require-auth";
import { deleteLink } from "@/lib/calendar/link";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST() {
  const denied = await requireAuthIfEnabled();
  if (denied) return denied;
  // カレンダー側の予定は消さない。消すと取り返しがつかない
  await deleteLink();
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: UIを書く**

`src/components/CalendarLink.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

/**
 * 設定画面のGoogleカレンダー連携。
 *
 * 本人がやることは「ボタンを押して同意する」だけにする。
 * カレンダーの作成も初回同期もサーバー側で済ませるので、
 * IDの入力もコピペも発生しない。
 */
export function CalendarLink() {
  const [state, setState] = useState<{
    connected: boolean;
    lastSyncedAt: string | null;
    lastError: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/calendar/status")
      .then((r) => r.json())
      .then(setState)
      .catch(() => setState({ connected: false, lastSyncedAt: null, lastError: null }));
  }, []);

  if (!state) {
    return <p className="mt-3 text-[12.5px] text-muted">確認中…</p>;
  }

  if (!state.connected) {
    return (
      <>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
          連携すると「目標設定コーチ」という専用カレンダーが作られ、時間割の予定と
          タイトル・時間が双方向に同期されます。ほかのカレンダーには触れません。
        </p>
        <a
          href="/api/calendar/connect"
          className="mt-3 flex min-h-11 items-center justify-center rounded-lg bg-indigo px-3 text-[13.5px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Googleカレンダーと連携する
        </a>
      </>
    );
  }

  return (
    <>
      <p className="mt-3 rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-[12.5px] text-accent">
        連携しています
        {state.lastSyncedAt &&
          `（最終同期 ${new Date(state.lastSyncedAt).toLocaleString("ja-JP")}）`}
      </p>
      {state.lastError && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-accent">
          直近のエラー: {state.lastError}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await fetch("/api/calendar/disconnect", { method: "POST" });
          setBusy(false);
          setState({ connected: false, lastSyncedAt: null, lastError: null });
        }}
        className="mt-3 min-h-11 rounded-lg border border-line bg-paper px-3 text-[13px] text-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        連携を解除する
      </button>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
        解除しても、カレンダー側の予定は消しません。
      </p>
    </>
  );
}
```

- [ ] **Step 3: 設定画面に差し込む**

`src/app/settings/page.tsx` の冒頭に追加:

```tsx
import { CalendarLink } from "@/components/CalendarLink";
```

「クラウド同期」の `</section>` の直後に追加:

```tsx
        {/* ── Googleカレンダー ─────────────────── */}
        <section className="mt-3 rounded-xl border border-line bg-surface px-4 py-4">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
            Googleカレンダー
          </h2>
          <CalendarLink />
        </section>
```

- [ ] **Step 4: 型チェックと実機確認**

Run: `npx tsc --noEmit && npm test`
Expected: 全て PASS

Run: `npm run dev` → `http://localhost:3000/settings`
Expected: 「Googleカレンダー」セクションが出る

- [ ] **Step 5: コミット**

```bash
git add src/components/CalendarLink.tsx src/app/api/calendar/status/route.ts src/app/api/calendar/disconnect/route.ts src/app/settings/page.tsx
git commit -m "feat: 設定画面にGoogleカレンダー連携のUIを足す"
```

---

### Task 8: 時間割を開いたときの自動同期と構造ガード

**Files:**
- Create: `src/components/CalendarSyncBoot.tsx`
- Modify: `src/app/plan/page.tsx`
- Modify: `tests/forbidden.test.mjs`

**Interfaces:**
- Consumes: Task 6 `POST /api/calendar/sync`、`getSyncState()`（`src/lib/supabase/sync.ts`）、`loadTimeBoxes()` / `upsertTimeBox()` / `deleteTimeBox()`（`src/lib/storage.ts`）、`emptyMeta()`（`src/types/timebox.ts`）
- Produces: `<CalendarSyncBoot onApplied={() => void} />`

- [ ] **Step 1: 起動コンポーネントを書く**

`src/components/CalendarSyncBoot.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { deleteTimeBox, loadTimeBoxes, upsertTimeBox } from "@/lib/storage";
import { getSyncState } from "@/lib/supabase/sync";
import { emptyMeta } from "@/types/timebox";

/**
 * 時間割を開いたときに1度だけカレンダーと突き合わせる。
 *
 * 【不変条件】Supabase同期の向きが決着するまで走らせない。
 * まっさらな端末で走ると「全部アプリで消された」と誤判定して
 * カレンダー側を空にする。クラウド同期で実際に踏んだ形の事故なので、
 * ここで明示的に止める。
 */
export function CalendarSyncBoot({ onApplied }: { onApplied: () => void }) {
  const ran = useRef(false);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (ran.current) return;
    // 向きが決着していなければ今回は見送る（次に開いたときに走る）
    if (getSyncState().kind !== "ready") return;
    ran.current = true;

    void (async () => {
      const boxes = loadTimeBoxes().map((b) => ({
        id: b.id,
        date: b.date,
        start: b.start,
        end: b.end,
        title: b.title,
        googleEventId: b.googleEventId ?? null,
        updatedAt: b.updatedAt,
        hasNotes: Boolean(
          b.meta.why || b.meta.obstacle || b.meta.counter || b.review,
        ),
      }));

      const res = await fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boxes, confirmDeletes: false }),
      }).catch(() => null);
      // 通信できなくても時間割は普通に使える
      if (!res) return;
      const data = await res.json().catch(() => null);
      if (!data?.ok) return;

      if (data.pendingDeletes > 0) {
        setPending(data.pendingDeletes);
        return;
      }

      const all = loadTimeBoxes();
      for (const u of data.upserts ?? []) {
        const cur = all.find((b) => b.id === u.id);
        if (!cur) continue;
        upsertTimeBox({
          ...cur,
          ...(u.title !== undefined ? { title: u.title } : {}),
          ...(u.date !== undefined ? { date: u.date } : {}),
          ...(u.start !== undefined ? { start: u.start } : {}),
          ...(u.end !== undefined ? { end: u.end } : {}),
          ...(u.googleEventId !== undefined ? { googleEventId: u.googleEventId } : {}),
        });
      }
      for (const im of data.imports ?? []) {
        upsertTimeBox({
          id: crypto.randomUUID(),
          date: im.date,
          start: im.start,
          end: im.end,
          title: im.title,
          cardId: null,
          googleEventId: im.googleEventId,
          meta: emptyMeta(),
          completedAt: null,
          review: null,
          createdAt: new Date().toISOString(),
        });
      }
      for (const id of data.deletes ?? []) deleteTimeBox(id);

      const changed =
        (data.upserts?.length ?? 0) +
        (data.imports?.length ?? 0) +
        (data.deletes?.length ?? 0);
      if (changed > 0) onApplied();
    })();
  }, [onApplied]);

  if (pending === 0) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-40 border-b border-accent bg-accent-soft px-5 py-3"
    >
      <div className="phone flex items-start gap-3">
        <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-accent">
          <strong className="block font-medium">
            {pending}件を削除しようとしています。
          </strong>
          数が多いので、いったん止めました。意図した削除か確認してください。
        </span>
        <button
          type="button"
          onClick={() => setPending(0)}
          className="shrink-0 rounded-md border border-accent-line px-2.5 py-1 text-[11.5px] text-accent"
        >
          あとで
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 時間割に差し込む**

`src/app/plan/page.tsx` の冒頭に追加:

```tsx
import { CalendarSyncBoot } from "@/components/CalendarSyncBoot";
```

この画面には既に `reload(d: string)`（`src/app/plan/page.tsx:68`）がある。
その日の枠を読み直す処理なので、そのまま渡す。`<main>` の直前に置く:

```tsx
<CalendarSyncBoot onApplied={() => reload(date)} />
```

- [ ] **Step 3: 構造ガードを足す**

`tests/forbidden.test.mjs` の `const pkg = JSON.parse(...)` の直前に追加:

```js
/*
 * カレンダー同期は、Supabase同期の向きが決着してからでないと走らせない。
 *
 * まっさらな端末で走ると「全部アプリで消された」と誤判定して
 * カレンダー側を空にする。クラウド同期で実際に踏んだ形なので、
 * ガードが外れていないことを機械的に見張る。
 */
{
  const file = join(SRC, "components", "CalendarSyncBoot.tsx");
  const text = readFileSync(file, "utf8");
  if (!/getSyncState\(\)\.kind\s*!==\s*"ready"/.test(text)) {
    failed++;
    console.error(
      `✗ ${relative(ROOT, file)}\n` +
        `  同期開始前の getSyncState() === "ready" の確認が無い\n` +
        `  → 空の端末で走ると、カレンダー側の予定を全部消しにいく\n`,
    );
  }

  /*
   * カレンダーは title/start/end しか持たない。
   * サーバーから返った値で meta / review / cardId / color を書き換えると、
   * 本人が書いたメタ認知と振り返りが同期のたびに消える。
   */
  for (const field of ["meta", "review", "cardId", "color"]) {
    if (new RegExp(`\\bu\\.${field}\\b`).test(text)) {
      failed++;
      console.error(
        `✗ ${relative(ROOT, file)}\n` +
          `  同期結果から ${field} を読んでいる\n` +
          `  → カレンダーはこの項目を持たない。書き戻すと本人の記入が消える\n`,
      );
    }
  }
}
```

- [ ] **Step 4: ガードがちゃんと落ちることを確認する**

落ちないガードは、あるだけ有害（安心だけ与えて何も守らない）。必ず壊して確かめる。

```bash
cp src/components/CalendarSyncBoot.tsx /tmp/csb.bak
sed -i 's/getSyncState().kind !== "ready"/false/' src/components/CalendarSyncBoot.tsx
node tests/forbidden.test.mjs
```
Expected: FAIL（exit 1、「確認が無い」と出る）

```bash
cp /tmp/csb.bak src/components/CalendarSyncBoot.tsx
node tests/forbidden.test.mjs
```
Expected: PASS

- [ ] **Step 5: 型チェックとテスト**

Run: `npx tsc --noEmit && npm test`
Expected: 全て PASS

- [ ] **Step 6: 実機で往復を確認する**

1. 時間割で枠を作る → Googleカレンダーの「目標設定コーチ」に出ること
2. カレンダー側でその予定の時間を変える → アプリを開き直して反映されること
3. カレンダー側で新しい予定を作る → アプリに取り込まれること
4. アプリで枠を消す → カレンダーからも消えること
5. **振り返りを書いた枠をカレンダー側で消す → アプリには残ること**

- [ ] **Step 7: コミット**

```bash
git add src/components/CalendarSyncBoot.tsx src/app/plan/page.tsx tests/forbidden.test.mjs
git commit -m "feat: 時間割を開いたときにカレンダーと同期する"
```

---

## 実装後の手作業

- [ ] `bash scripts/push-env-to-vercel.sh --apply` で `GOOGLE_OAUTH_*` を本番へ送る
- [ ] 本番にデプロイ後、`https://prototype-management-tool.vercel.app/settings` から連携を1回通す
- [ ] Google Cloud のリダイレクトURI追加は **済**（2026-09-05）
