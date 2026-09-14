"use client";

/**
 * ローカル保存 → Supabase への裏書き込み。
 *
 * storage.ts の同期API（loadCards / upsertCard など）はそのまま残し、
 * write() が呼ばれるたびにこのファイルの pushKey() が裏で呼ばれる形にしてある
 * （フックの登録は storage.ts の setSyncHook）。
 * 失敗しても localStorage 側の保存は成功しているので、画面には影響しない。
 * ログインしていない・オフラインのときは何も起きない（前と同じ動作）。
 */
import {
  captureState,
  DEVICE_KEY,
  hasUserContent,
  KEY,
  loadCheckpoints,
  readDeviceFlag,
  replaceCheckpoints,
  restoreState,
  setSyncFlushHook,
  setSyncHook,
  writeDeviceFlag,
} from "@/lib/storage";
import { createPushQueue } from "./push-queue";
import {
  carryOverOnPull,
  decideSyncDirection,
  isForeignKeyViolation,
  mergeCheckpoints,
  mergeSnapshots,
  sendableCheckpoint,
} from "./sync-decision";
import { isValidUuid } from "@/lib/uuid";
import { supabaseBrowser } from "./client";
import {
  bigStoryFromRow,
  bigStoryToRow,
  checkpointFromRow,
  checkpointToRow,
  goalCardFromRow,
  goalCardToRow,
  habitFromRow,
  habitLogFromRow,
  habitLogToRow,
  habitToRow,
  profileFromRow,
  profileToRow,
  sessionFromRow,
  sessionToRow,
  timeBoxFromRow,
  timeBoxToRow,
  usageToRows,
} from "./mappers";
import type { BigStory, Checkpoint, GoalCard, Session, UserProfile } from "@/types/goal";
import type { Habit, HabitLog } from "@/types/behavior";
import type { TimeBox } from "@/types/timebox";

let currentUserId: string | null = null;
/** 直近の失敗を軽く覚えておく。UIで「未同期」を示すのに使う */
let lastSyncError: { at: string; message: string } | null = null;

export function getLastSyncError() {
  return lastSyncError;
}

/**
 * 同期の失敗を画面へ出すための購読口。
 *
 * これまで lastSyncError は設定画面を開いたときにしか読まれず、
 * 「保存が失敗し続けているのに、本人は気づかないまま入力を続ける」
 * という壊れ方をした（別の端末で見て初めて分かった）。
 * 状態(SyncState)は ready のままなので、状態の購読だけでは捕まらない。
 */
const errorListeners = new Set<(e: typeof lastSyncError) => void>();

export function onSyncError(fn: (e: typeof lastSyncError) => void): () => void {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

/**
 * 同期の状態。UI（設定画面）が、いま何が起きているかを出すために使う。
 *
 * conflict は「この端末にもクラウドにも中身があり、しかもこの端末は
 * まだ一度もこのアカウントと突き合わせていない」状態。どちらが正しいかを
 * 機械的に決める方法が無いので、本人に選んでもらうまで push は繋がない。
 */
export type SyncState =
  | { kind: "off" }
  | { kind: "checking" }
  | { kind: "pulling" }
  | { kind: "pushing" }
  | { kind: "ready" }
  /** otherUser: この端末のデータが別のアカウントのものだった（引き継ぐかを聞く） */
  | { kind: "conflict"; otherUser?: boolean }
  | { kind: "failed"; message: string };

let syncState: SyncState = { kind: "off" };
const stateListeners = new Set<(s: SyncState) => void>();

export const getSyncState = (): SyncState => syncState;

export function onSyncState(fn: (s: SyncState) => void): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

function setState(s: SyncState): void {
  syncState = s;
  for (const fn of stateListeners) fn(s);
}

/**
 * push（ローカル保存 → クラウド）を繋ぐ／切る。
 *
 * pushKey() の突き合わせは「ローカルに無いものはクラウドからも消す」なので、
 * 取り込みが済んでいない空の端末で繋ぐと、クラウド側を空にしてしまう。
 * 向きが決まるまでは必ず切っておく。
 */
let pushEnabled = false;

/**
 * 1文字ごとの全件送信をまとめる待ち行列。
 *
 * まとめるのは、保存ボタンを押させない画面が書くキーだけ。
 * 予定シートは1キーストロークごとに `gc.timeboxes` の全行を、
 * 習慣の編集（「どこで」「きっかけ」）は `gc.habits` の全行を送っていた。
 * 他のキーは編集の確定時にしか書かれないので素通しする。
 *
 * 外部キーの順序（timeboxes → cards / habits）は気にしなくてよい。
 * 参照先が未同期で弾かれたときは healIfDanglingReference() が
 * 依存順に送り直す（既存の自己修復）。
 */
const pushQueue = createPushQueue({
  debounced: [KEY.timeboxes, KEY.habits],
  send: (key, value) => void pushKey(key, value),
});

/**
 * 待っているぶんを、いますぐ送る。
 * タブを閉じる・隠す瞬間に SyncBoot が呼ぶ。
 */
export function flushPendingPushes(): void {
  pushQueue.flush();
}

/*
 * 消す操作（いまは deleteCard）が、待たずに送り切るために使う。
 * push が繋がっていなければ待ち行列は空なので、呼ばれても何も起きない。
 * このモジュールが読み込まれた時点で繋ぐ（enablePush を待つ必要がない）。
 */
setSyncFlushHook(() => pushQueue.flush());

/** いま送るのを待っているキー（診断用） */
export const pendingPushKeys = (): string[] => pushQueue.pendingKeys();

function enablePush(): void {
  pushEnabled = true;
  setSyncHook(currentUserId ? (key, value) => pushQueue.push(key, value) : null);
}

function disablePush(): void {
  pushEnabled = false;
  /*
   * 送らずに捨てる。ログアウト後や、向きが決まる前に送ると
   * 「別のユーザーの端末から古い値を押し込む」ことになる。
   * localStorage 側は残っているので、繋ぎ直せば backfill で追いつく。
   */
  pushQueue.cancel();
  setSyncHook(null);
}

/**
 * エラーを人が読める1行にする。
 *
 * Supabase が返すエラーは Error のインスタンスではなく、
 * { message, details, hint, code } を持つただのオブジェクトである。
 * そのため `String(err)` は "[object Object]" になり、画面にも
 * コンソールにも理由が一切残らなかった（実際に「同期に失敗しました
 * （gc.timeboxes）: [object Object]」とだけ出て、原因の特定に
 * 手間取った）。原因が読めない失敗は、無いのと同じくらい質が悪い。
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts = [e.message, e.details, e.hint, e.code]
      .filter((v): v is string | number => v !== null && v !== undefined && v !== "")
      .map(String);
    if (parts.length > 0) return parts.join(" / ");
    try {
      return JSON.stringify(err);
    } catch {
      /* 循環参照などで文字列化できないときは、下の String() に落とす */
    }
  }
  return String(err);
}

function noteFailure(context: string, err: unknown) {
  lastSyncError = {
    at: new Date().toISOString(),
    message: `${context}: ${describeError(err)}`,
  };
  failureSeq++;
  // 同期は保険。落ちてもコンソールに残すだけで、ユーザー操作は止めない
  console.warn("[supabase sync]", lastSyncError.message, err);
  for (const fn of errorListeners) fn(lastSyncError);
}

/**
 * 成功したので、直前の失敗を取り下げる。
 *
 * これが無かったせいで、`lastSyncError` に null を入れる箇所がコード全体に
 * 一つも無く、**一度でも失敗すると、その後どれだけ成功しても帯が出続けた**。
 * 一時的な通信断や、自己修復が成功した直後にも起きる。
 * 「保存できていないと言い続ける」のは、黙って壊れるのと同じくらい悪い。
 *
 * 既に取り下げ済みなら購読者を起こさない（毎回の保存で無駄に再描画しない）。
 */
function clearFailure(): void {
  if (lastSyncError === null) return;
  lastSyncError = null;
  for (const fn of errorListeners) fn(null);
}

/**
 * noteFailure が呼ばれた回数。
 *
 * 「この処理の間に新しい失敗が記録されたか」を見るために使う。
 * 中で警告を出しつつ全体としては成功する経路があるため
 * （不正IDの行を除外したときなど）、最後に無条件で取り下げると
 * その警告まで消してしまう。回数で見分ける。
 */
let failureSeq = 0;

/**
 * 配列で持つコレクション（goal_cards / habits / habit_logs / timeboxes）を
 * まるごと突き合わせる。この規模のデータなら、差分計算より
 * 「消えたものを消して、残ったものを upsert する」ほうが取りこぼしがない。
 */
async function reconcileCollection(
  table: string,
  userId: string,
  incomingIds: string[],
  idColumn: string,
  rows: Record<string, unknown>[],
) {
  const supabase = supabaseBrowser();

  /*
   * 主キーが uuid 列のテーブルでは、UUIDでない ID の行を先に外す。
   *
   * upsert は配列を1回で送るので、1件でも `22P02
   * (invalid input syntax for type uuid)` になると**その回の書き込みが
   * まるごと拒否される**。つまり不正な1件が、正常な他の全部を道連れにする。
   * しかも本人の操作は成功して見えるため、別端末で開くまで気づけない。
   *
   * 移行 v3 が localStorage 側を直すので、ここへ来るのは
   * 移行より先に同期が走った場合などの取りこぼしだけ。
   * 落としたことは黙らせず、帯に出して本人に伝える。
   */
  let sendRows = rows;
  if (idColumn === "id") {
    const bad = rows.filter((r) => !isValidUuid(r.id));
    if (bad.length > 0) {
      sendRows = rows.filter((r) => isValidUuid(r.id));
      noteFailure(
        `${table}: IDの形式が不正な${bad.length}件を送れませんでした`,
        new Error(
          `uuid ではない id: ${bad
            .slice(0, 3)
            .map((r) => String(r.id))
            .join(", ")}`,
        ),
      );
    }
  }

  const { data: existing, error: readErr } = await supabase
    .from(table)
    .select(idColumn)
    .eq("user_id", userId);
  if (readErr) throw readErr;

  /*
   * 消す判断には、送れなかった行の ID も「残す」側へ入れておく。
   * 除外したぶんを keep から外すと、クラウド側にある対応する行を
   * 「ローカルで消された」とみなして消してしまう。
   */
  const keep = new Set(incomingIds);
  const gone = (existing ?? [])
    .map((r: Record<string, unknown>) => r[idColumn] as string)
    .filter((id: string) => !keep.has(id));

  /*
   * 先に書き、あとで消す。順序を逆にすると、削除だけ成功して
   * upsert が失敗したときに、消した行が戻らないまま終わる。
   * この順なら、upsert が失敗しても消えたものは無く、
   * 逆に delete が失敗しても余分な行が残るだけで、次の同期で片付く。
   * 失うより、余るほうがましである。
   */
  if (sendRows.length > 0) {
    const { error } = await supabase.from(table).upsert(sendRows);
    if (error) throw error;
  }
  if (gone.length > 0) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("user_id", userId)
      .in(idColumn, gone);
    if (error) throw error;
  }
}

/** habit_logs だけ主キーが複合（habit_id, date）なので、専用の突き合わせにする */
async function reconcileHabitLogs(userId: string, logs: HabitLog[]) {
  const supabase = supabaseBrowser();
  const { data: existing, error: readErr } = await supabase
    .from("habit_logs")
    .select("habit_id, date")
    .eq("user_id", userId);
  if (readErr) throw readErr;

  const keep = new Set(logs.map((l) => `${l.habitId}|${l.date}`));
  const gone = (existing ?? []).filter(
    (r: { habit_id: string; date: string }) => !keep.has(`${r.habit_id}|${r.date}`),
  ) as { habit_id: string; date: string }[];

  for (const g of gone) {
    const { error } = await supabase
      .from("habit_logs")
      .delete()
      .eq("user_id", userId)
      .eq("habit_id", g.habit_id)
      .eq("date", g.date);
    if (error) throw error;
  }
  if (logs.length > 0) {
    const { error } = await supabase
      .from("habit_logs")
      .upsert(logs.map((l) => habitLogToRow(l, userId)));
    if (error) throw error;
  }
}

/**
 * 1回の書き込みぶんを Supabase へ反映する。
 * write() から渡ってくる value は「そのキーの localStorage の中身そのもの」。
 */
export async function pushKey(
  key: string,
  value: unknown,
  /**
   * この値を誰のものとして送るか。まとめて送る処理（backfillAll）が渡す。
   * 途中でアカウントが切り替わったら、残りを新しいユーザーの名前で送らない
   * （セキュリティレビュー指摘7）。
   */
  expectedUserId?: string,
): Promise<void> {
  const userId = currentUserId;
  if (!userId) return; // ログインしていなければ何もしない
  if (expectedUserId !== undefined && expectedUserId !== userId) return;

  const seenBefore = failureSeq;
  try {
    const wrote = await pushOne(key, value, userId);
    /*
     * 実際に書けて、その間に新しい失敗も記録されていないときだけ取り下げる。
     *
     * - 同期対象外のキー（schemaVersion 等）で取り下げると、
     *   本物の失敗を無関係な書き込みで握りつぶす
     * - 中で警告を出した経路（不正IDの除外）で取り下げると、
     *   本人に伝えるべき警告が即座に消える
     */
    if (wrote && failureSeq === seenBefore) clearFailure();
  } catch (err) {
    noteFailure(`同期に失敗しました（${key}）`, err);
    await healIfDanglingReference(err);
  }
}

/**
 * 1キー分の書き込み本体。書いたら true、同期対象外なら false。
 *
 * pushKey から分けてあるのは、switch の中に return が多く、
 * 「成功したか」を呼び出し側で1箇所にまとめて判断するため。
 */
async function pushOne(
  key: string,
  value: unknown,
  userId: string,
): Promise<boolean> {
  {
    const supabase = supabaseBrowser();

    switch (key) {
      case KEY.bigstory: {
        if (value === null) {
          const { error } = await supabase
            .from("big_stories")
            .delete()
            .eq("user_id", userId);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("big_stories")
            .upsert(bigStoryToRow(value as BigStory, userId));
          if (error) throw error;
        }
        return true;
      }
      case KEY.profile: {
        if (value === null) return false; // プロフィールは明示的に消す操作が無い
        const { error } = await supabase
          .from("user_profiles")
          .upsert(profileToRow(value as UserProfile, userId));
        if (error) throw error;
        return true;
      }
      case KEY.session: {
        if (value === null) return false; // 「進行中を閉じた」だけ。行自体は消さない
        const s = value as Session;
        const { error } = await supabase.from("sessions").upsert(sessionToRow(s, userId));
        if (error) throw error;
        const usageRows = usageToRows(s, userId);
        if (usageRows.length > 0) {
          const { error: uErr } = await supabase
            .from("token_usage")
            .upsert(usageRows, { onConflict: "session_id,at,kind", ignoreDuplicates: true });
          if (uErr) throw uErr;
        }
        return true;
      }
      case KEY.archive: {
        const sessions = value as Session[];
        if (sessions.length === 0) return false;
        const { error } = await supabase
          .from("sessions")
          .upsert(sessions.map((s) => sessionToRow(s, userId)));
        if (error) throw error;
        for (const s of sessions) {
          const usageRows = usageToRows(s, userId);
          if (usageRows.length === 0) continue;
          const { error: uErr } = await supabase
            .from("token_usage")
            .upsert(usageRows, { onConflict: "session_id,at,kind", ignoreDuplicates: true });
          if (uErr) throw uErr;
        }
        return true;
      }
      case KEY.cards: {
        const cards = value as GoalCard[];
        await reconcileCollection(
          "goal_cards",
          userId,
          cards.map((c) => c.id),
          "id",
          cards.map((c) => goalCardToRow(c, userId)),
        );
        return true;
      }
      case KEY.habits: {
        const habits = value as Habit[];
        await reconcileCollection(
          "habits",
          userId,
          habits.map((h) => h.id),
          "id",
          habits.map((h) => habitToRow(h, userId)),
        );
        return true;
      }
      case KEY.habitLogs: {
        await reconcileHabitLogs(userId, value as HabitLog[]);
        return true;
      }
      case KEY.timeboxes: {
        const boxes = value as TimeBox[];
        await reconcileCollection(
          "timeboxes",
          userId,
          boxes.map((b) => b.id),
          "id",
          boxes.map((b) => timeBoxToRow(b, userId)),
        );
        return true;
      }
      case KEY.checkpoints: {
        /*
         * 端末ごとに一度クラウドと合わせるまでは送らない（R16）。
         * 合わせる前の全件送信は、別の端末から上がった中間目標を消す。
         * ensureCheckpointsMerged が合わせたあと、印を付けてからここを通す。
         */
        if (readDeviceFlag(DEVICE_KEY.checkpointsMerged) !== userId) return false;
        const all = (value ?? []) as Checkpoint[];
        const ok = all.filter(sendableCheckpoint);
        if (ok.length < all.length) {
          noteFailure(
            `checkpoints: 形式が不正な中間目標${all.length - ok.length}件を送れませんでした`,
            new Error("id・目標ID・期間の日付・種類・状態のいずれかが不正"),
          );
        }
        await reconcileCollection(
          "checkpoints",
          userId,
          // 送れなかったものも「残す」側に入れる。外すとクラウドの対応する行を消してしまう
          all.map((c) => c.id),
          "id",
          ok.map((c) => checkpointToRow(c, userId)),
        );
        return true;
      }
      default:
        // schemaVersion / variant / snapshots はローカルだけの関心事。同期しない
        return false;
    }
  }
}

/**
 * 参照先がまだクラウドに無いせいで失敗したなら、依存順に全部送り直す。
 *
 * timeboxes は目標カードと習慣を参照する。pushKey は「書き込みのあった
 * キーだけ」を送るので、ログインより前に作った習慣のように
 * 「ローカルにはあるが、その後一度も書かれていないもの」はクラウドへ届かない。
 * その状態で時間割を保存すると外部キー違反になり、**毎回まるごと拒否され続ける**。
 * 実際にこれで、1日分の予定が別端末に現れないまま溜まった。
 *
 * backfillAll() はカード・習慣を時間割より先に送るので、一度通せば解消する。
 * 自分自身が pushKey を呼ぶため、再入は healing で止める。
 */
let healing = false;

async function healIfDanglingReference(err: unknown): Promise<void> {
  if (healing || !isForeignKeyViolation(err)) return;
  healing = true;
  try {
    console.warn("[supabase sync] 参照先が未同期のため、依存順に送り直します");
    /*
     * 修復が成功したら、引き金になった失敗を取り下げる。
     *
     * 呼び出し元は noteFailure を済ませてからここへ来るので、
     * 黙って戻ると「直ったのに帯が出たまま」になる。
     * backfillAll は全部送れたときに自分で取り下げるが、
     * ここでも明示しておく（読む人が順序を追わなくて済む）。
     */
    const r = await backfillAll();
    if (r.ok) clearFailure();
  } catch (e) {
    noteFailure("送り直しにも失敗しました", e);
  } finally {
    healing = false;
  }
}

/**
 * いま localStorage にあるものを一括で Supabase へ送る（バックフィル）。
 * captureState() は既存のスナップショット機能が使っているのと同じ取り出しで、
 * 「今の状態をまるごと書き出す」目的にそのまま転用できる。
 */
export async function backfillAll(): Promise<{
  ok: boolean;
  pushed: string[];
  failed: string[];
}> {
  const userId = currentUserId;
  if (!userId) return { ok: false, pushed: [], failed: [] };
  const snap = captureState();
  const pushed: string[] = [];
  const failed: string[] = [];
  // sessions（archive）は big_stories/goal_cards が参照する session_id の先に
  // なるので、他より先に送る。順序を間違えるとFK違反で goal_cards が弾かれる
  // checkpoints は goal_cards を参照するので、カードより後に送る
  const order = [KEY.session, KEY.archive, KEY.bigstory, KEY.cards, KEY.habits, KEY.habitLogs, KEY.timeboxes, KEY.checkpoints, KEY.profile];
  const keys = [...order.filter((k) => k in snap), ...Object.keys(snap).filter((k) => !order.includes(k as (typeof order)[number]))];

  for (const key of keys) {
    // 取り出したのは開始時のユーザーの状態。切り替わったら残りは送らない
    if (currentUserId !== userId) return { ok: false, pushed, failed };
    const raw = snap[key];
    if (raw === undefined) continue;
    /*
     * 「新しい失敗が記録されたか」は回数で見る。
     * lastSyncError の中身を比べる形だと、pushKey が成功して
     * 失敗を取り下げた（null にした）ときに、前の値と違うという理由で
     * 「失敗した」と数えてしまう。
     */
    const before = failureSeq;
    try {
      await pushKey(key, JSON.parse(raw), userId);
      if (failureSeq === before) pushed.push(key);
      else failed.push(key);
    } catch (err) {
      noteFailure(`バックフィルに失敗しました（${key}）`, err);
      failed.push(key);
    }
  }
  // 全部送れたなら、それ以前の失敗はもう残っていない
  if (failed.length === 0) clearFailure();
  return { ok: failed.length === 0, pushed, failed };
}

/**
 * Supabase の中身で localStorage を上書きする（クラウドが正とみなす）。
 * 新しいブラウザ・別端末で最初にログインしたときのための取り込み。
 *
 * restoreState() は内部で対象キーを一度すべて remove() するため、
 * その remove() が同期フックを再度呼んで Supabase 側を消しにいく
 * （読み込んでいるだけなのに書き戻ってしまう）事故を避けるため、
 * 書き込んでいる間だけフックを止める。
 *
 * gc.running / gc.variant / gc.schemaVersion は Supabase に対応するテーブルを
 * 持たない、この端末だけの関心事（走っている打刻・A/Bの割り当て・移行の版）。
 * gc.checkpoints（中間目標）は、この端末がまだクラウドと一度も合わせていなければ
 * ローカルの分も残してクラウドと合わせる（R16。合わせる前のローカルはクラウドに
 * 上がっていないので、クラウドを正とすると消える）。合わせ済みならクラウドが正。
 * 何もしないと restoreState() の remove() だけが効いて、これらが
 * 無警告で消える（実際に「走行中の打刻が消える」形で見つかった不具合）。
 * クラウド由来のデータを詰める前に、いまの値をそのまま持ち越しておく。
 */
export async function pullAll(): Promise<boolean> {
  const userId = currentUserId;
  if (!userId) return false;
  try {
    const cloud = await fetchCloudSnapshot(userId);
    if (!cloud) return false;
    return writeLocalWithoutPush(cloud.data);
  } catch (err) {
    noteFailure("クラウドからの取り込みに失敗しました", err);
    return false;
  }
}

/**
 * localStorage を丸ごと書き換える。書いている間は同期フックを止める。
 *
 * restoreState() は対象キーを一度 remove() するので、フックが繋がっていると
 * 読み込んでいるだけなのに Supabase 側を消しにいく。待ち行列に残っている
 * 「書き換え前の値」も、後から押し戻すと意味が消えるので捨てる。
 */
function writeLocalWithoutPush(data: Record<string, string>): boolean {
  setSyncHook(null);
  pushQueue.cancel();
  const ok = restoreState(data);
  // 書き換え前に push が繋がっていたときだけ繋ぎ直す。
  // まだ向きが決まっていない段階で勝手に繋がないようにする
  if (pushEnabled) setSyncHook((key, value) => pushQueue.push(key, value));
  return ok;
}

/**
 * クラウドの中身を、captureState() と同じ形（キー → JSON文字列）で取ってくる。
 * 端末固有のキーと、まだクラウドに上がっていない中間目標は、この端末の値を持ち越してある。
 * ログアウト・切り替えが挟まったら null。
 */
async function fetchCloudSnapshot(
  userId: string,
): Promise<{ data: Record<string, string> } | null> {
  const supabase = supabaseBrowser();
  {
    const [big, profile, cards, habits, logs, boxes, sessions, checkpoints] = await Promise.all([
      supabase.from("big_stories").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("user_profiles").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("goal_cards").select("*").eq("user_id", userId),
      supabase.from("habits").select("*").eq("user_id", userId),
      supabase.from("habit_logs").select("*").eq("user_id", userId),
      supabase.from("timeboxes").select("*").eq("user_id", userId),
      supabase
        .from("sessions")
        .select("*")
        .eq("user_id", userId)
        .order("started_at", { ascending: false }),
      supabase.from("checkpoints").select("*").eq("user_id", userId),
    ]);
    for (const r of [big, profile, cards, habits, logs, boxes, sessions, checkpoints]) {
      if (r.error) throw r.error;
    }
    /*
     * 待っている間にログアウト・アカウント切り替えが起きていたら書き戻さない
     * （セキュリティレビュー指摘7）。呼び出し側の比較は復元の後なので遅く、
     * ログアウトした画面に前のユーザーのデータが戻っていた。
     */
    if (currentUserId !== userId) return null;

    // 未完了のうち一番新しいものを「進行中」とみなす。それ以外は archive
    const sessionRows = (sessions.data ?? []) as Record<string, unknown>[];
    const currentRow = sessionRows.find((r) => r.completed_at === null);
    const archiveRows = sessionRows.filter((r) => r !== currentRow);

    // この端末だけの値（とクラウドに乗っていない中間目標）を、
    // クラウド由来のデータで上書きされる前に確保しておく
    const pulledCards: GoalCard[] = (cards.data ?? []).map(goalCardFromRow);
    const data: Record<string, string> = carryOverOnPull(
      captureState(),
      pulledCards.map((c) => c.id),
    );
    if (big.data) data[KEY.bigstory] = JSON.stringify(bigStoryFromRow(big.data));
    if (profile.data) data[KEY.profile] = JSON.stringify(profileFromRow(profile.data));
    data[KEY.cards] = JSON.stringify(pulledCards);
    data[KEY.habits] = JSON.stringify((habits.data ?? []).map(habitFromRow));
    data[KEY.habitLogs] = JSON.stringify((logs.data ?? []).map(habitLogFromRow));
    data[KEY.timeboxes] = JSON.stringify((boxes.data ?? []).map(timeBoxFromRow));
    {
      const cloudCps = (checkpoints.data ?? []).map(checkpointFromRow);
      const carried = data[KEY.checkpoints]
        ? (JSON.parse(data[KEY.checkpoints]) as Checkpoint[])
        : [];
      const merged =
        readDeviceFlag(DEVICE_KEY.checkpointsMerged) === userId
          ? cloudCps
          : mergeCheckpoints(carried, cloudCps);
      if (merged.length > 0) data[KEY.checkpoints] = JSON.stringify(merged);
      else delete data[KEY.checkpoints];
    }
    if (currentRow) data[KEY.session] = JSON.stringify(sessionFromRow(currentRow));
    data[KEY.archive] = JSON.stringify(archiveRows.map(sessionFromRow));
    return { data };
  }
}

/**
 * 突合済みの端末を開いたとき、クラウドと合体してから送る（2026-09-14）。
 *
 * 以前はこの場面で backfillAll（この端末を正として全部送る）をしていた。
 * 送信は「手元に無い行はクラウドから消す」ので、しばらく開いていなかった端末を
 * 開くと、別の端末で足したものがクラウドから消えた（本番で実際に起きた）。
 * 合体した結果をまずこの端末に書き、それを送る。どちらの端末のものも消えない。
 *
 * 戻り値は「この端末の中身が変わったか」。変わったら画面を読み直させる。
 */
async function mergeWithCloud(userId: string): Promise<{ ok: boolean; changed: boolean }> {
  const cloud = await fetchCloudSnapshot(userId);
  if (!cloud || currentUserId !== userId) return { ok: false, changed: false };
  const local = captureState();
  const merged = mergeSnapshots(local, cloud.data);
  const changed = Object.keys(merged).some((k) => merged[k] !== local[k]);
  if (changed && !writeLocalWithoutPush(merged)) return { ok: false, changed: false };
  return { ok: true, changed };
}

/**
 * 中間目標を、この端末で一度だけクラウドと合わせて送る（R16、2026-09-14）。
 *
 * すでに同期している端末は、開くたびに全部を送り直す（backfillAll）。
 * 中間目標のテーブルを足した直後にそのまま送ると、送信の突き合わせが
 * 「手元に無い行はクラウドから消す」なので、**別の端末から上がった中間目標を消す**。
 * そこで最初の1回だけ、クラウドの分を取ってきてローカルと合わせ、
 * 合わせた結果を書き戻してから送る。印が付いたあとはふつうの送信に任せる。
 *
 * 失敗したら印を戻す（次回やり直す）。そのあいだ中間目標の送信は止まるが、
 * ローカルには残っているので失うものは無い。
 */
async function ensureCheckpointsMerged(userId: string): Promise<boolean> {
  if (readDeviceFlag(DEVICE_KEY.checkpointsMerged) === userId) return true;
  const supabase = supabaseBrowser();
  const { data, error } = await supabase.from("checkpoints").select("*").eq("user_id", userId);
  if (error) {
    noteFailure("中間目標をクラウドと合わせられませんでした", error);
    return false;
  }
  if (currentUserId !== userId) return false;
  const merged = mergeCheckpoints(loadCheckpoints(), (data ?? []).map(checkpointFromRow));
  // 書き戻しで同期フックが走っても、印がまだ無いので pushOne は送らない
  if (!replaceCheckpoints(merged)) return false;
  const before = failureSeq;
  writeDeviceFlag(DEVICE_KEY.checkpointsMerged, userId);
  await pushKey(KEY.checkpoints, merged);
  if (failureSeq !== before) {
    // 送れなかった。印を戻して次回やり直す（合わせた結果はローカルに残っている）
    writeDeviceFlag(DEVICE_KEY.checkpointsMerged, "");
    return false;
  }
  return true;
}

/** クラウド側に、このユーザーの成果物が1件でもあるか */
async function cloudHasContent(userId: string): Promise<boolean> {
  const supabase = supabaseBrowser();
  const tables = ["big_stories", "goal_cards", "timeboxes", "habits", "sessions"];
  for (const t of tables) {
    const { count, error } = await supabase
      .from(t)
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw error;
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/**
 * ログインした直後に、同期の向きを決める。
 *
 * ここが無かったせいで、本番で「ローカルで作ったものが出てこない」
 * という状態になっていた。push しか繋いでおらず、pull は設定画面の
 * ボタンを自分で押したときにしか走らなかったため。
 *
 * さらに悪いことに、空の端末で push だけが繋がると、最初の保存操作で
 * クラウド側のデータが「ローカルに無いもの」として消える。
 * 向きが決まるまで push を繋がないのは、その事故を防ぐため。
 */
async function resolveInitialSync(userId: string): Promise<void> {
  setState({ kind: "checking" });
  try {
    const syncedUser = readDeviceFlag(DEVICE_KEY.syncedUser);
    const inputs = {
      alreadySynced: syncedUser === userId,
      // この端末のデータが別のアカウントのものとして同期されていた
      localOwnedByOtherUser: Boolean(syncedUser) && syncedUser !== userId,
      localHasContent: hasUserContent(captureState()),
      cloudHasContent: await cloudHasContent(userId),
    };
    // 確認している間にログアウト・アカウント切り替えが起きていたら手を引く
    if (currentUserId !== userId) return;

    switch (decideSyncDirection(inputs)) {
      case "pull": {
        setState({ kind: "pulling" });
        const ok = await pullAll();
        if (currentUserId !== userId) return;
        if (!ok) {
          setState({ kind: "failed", message: "クラウドからの取り込みに失敗しました" });
          return;
        }
        writeDeviceFlag(DEVICE_KEY.syncedUser, userId);
        enablePush();
        // 再読み込みの前に済ませる。後だと送信の途中でページが消える
        await ensureCheckpointsMerged(userId);
        if (currentUserId !== userId) return;
        setState({ kind: "ready" });
        /*
         * 画面はもう localStorage を読み終えている（各ページは useEffect で
         * 一度読むだけ）。取り込んだ内容を出すには読み直しが要る。
         * 端末ごとに最初の1回しか起きないので、素直に読み込み直す。
         * 印（gc.syncedUser）は先に書いてあるので、繰り返しにはならない。
         */
        if (typeof location !== "undefined") location.reload();
        return;
      }

      case "push": {
        enablePush();
        writeDeviceFlag(DEVICE_KEY.syncedUser, userId);
        setState({ kind: "pushing" });
        // 全件送信より先に。合わせる前に送ると、別端末の中間目標を消す
        await ensureCheckpointsMerged(userId);
        if (currentUserId !== userId) return;
        await backfillAll();
        if (currentUserId !== userId) return;
        setState({ kind: "ready" });
        return;
      }

      case "merge": {
        setState({ kind: "pulling" });
        let merged: { ok: boolean; changed: boolean };
        try {
          merged = await mergeWithCloud(userId);
        } catch (err) {
          noteFailure("クラウドと合わせられませんでした", err);
          merged = { ok: false, changed: false };
        }
        if (currentUserId !== userId) return;
        if (!merged.ok) {
          // 合わせられないまま送ると、別端末のものを消す。送信は繋がない
          setState({ kind: "failed", message: "クラウドと合わせられませんでした" });
          return;
        }
        enablePush();
        writeDeviceFlag(DEVICE_KEY.syncedUser, userId);
        await ensureCheckpointsMerged(userId);
        if (currentUserId !== userId) return;
        // 合体した結果を送る。クラウドにしか無かったものも localStorage に入っているので消えない
        await backfillAll();
        if (currentUserId !== userId) return;
        setState({ kind: "ready" });
        /*
         * 画面は合体前の localStorage を読み終えている。増えたものを出すには読み直しが要る。
         * 読み直した後は合体しても変化が無いので、繰り返しにはならない。
         */
        if (merged.changed && typeof location !== "undefined") location.reload();
        return;
      }

      case "ready": {
        enablePush();
        writeDeviceFlag(DEVICE_KEY.syncedUser, userId);
        await ensureCheckpointsMerged(userId);
        if (currentUserId !== userId) return;
        setState({ kind: "ready" });
        return;
      }

      case "conflict":
        // 本人が選ぶまで push は繋がない（勝手に片方を消さない）
        setState({
          kind: "conflict",
          otherUser: inputs.localHasContent && inputs.localOwnedByOtherUser,
        });
        return;
    }
  } catch (err) {
    noteFailure("同期の向きを判断できませんでした", err);
    setState({
      kind: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 衝突（両方に中身がある）を本人の選択で解決する。設定画面から呼ぶ。
 * "pull" ＝ クラウドを正としてこの端末を上書き、"push" ＝ この端末を正として送る。
 */
export async function resolveConflict(direction: "pull" | "push"): Promise<boolean> {
  const userId = currentUserId;
  if (!userId) return false;

  if (direction === "pull") {
    setState({ kind: "pulling" });
    const ok = await pullAll();
    if (currentUserId !== userId) return false;
    if (!ok) {
      setState({ kind: "failed", message: "取り込みに失敗しました" });
      return false;
    }
  } else {
    setState({ kind: "pushing" });
    enablePush();
    await ensureCheckpointsMerged(userId);
    const r = await backfillAll();
    if (!r.ok) {
      setState({ kind: "failed", message: "送信に一部失敗しました" });
      return false;
    }
  }

  writeDeviceFlag(DEVICE_KEY.syncedUser, userId);
  enablePush();
  // pull で合わせた中間目標は、まだ送っていない。ここで送る（合わせ済みなら何もしない）
  await ensureCheckpointsMerged(userId);
  setState({ kind: "ready" });
  return true;
}

/**
 * ログイン状態が変わったときに呼ぶ。
 *
 * 以前はここで push フックを繋ぐだけだった。それだと
 * 「クラウドにあるものを取りに行く」経路が自動では一度も走らない。
 * いまは向きを決めてから繋ぐ（resolveInitialSync）。
 */
export function setSyncUser(userId: string | null): void {
  const prev = currentUserId;
  currentUserId = userId;

  if (!userId) {
    disablePush();
    setState({ kind: "off" });
    return;
  }
  // 同じユーザーで呼び直されただけなら、決着済みの状態を壊さない
  if (prev === userId && syncState.kind !== "off") return;

  disablePush();
  void resolveInitialSync(userId);
}
