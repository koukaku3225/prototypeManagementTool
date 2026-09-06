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
  readDeviceFlag,
  restoreState,
  setSyncHook,
  writeDeviceFlag,
} from "@/lib/storage";
import { decideSyncDirection, isForeignKeyViolation } from "./sync-decision";
import { supabaseBrowser } from "./client";
import {
  bigStoryFromRow,
  bigStoryToRow,
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
import type { BigStory, GoalCard, Session, UserProfile } from "@/types/goal";
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
  | { kind: "conflict" }
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

function enablePush(): void {
  pushEnabled = true;
  setSyncHook(currentUserId ? (key, value) => void pushKey(key, value) : null);
}

function disablePush(): void {
  pushEnabled = false;
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
  // 同期は保険。落ちてもコンソールに残すだけで、ユーザー操作は止めない
  console.warn("[supabase sync]", lastSyncError.message, err);
  for (const fn of errorListeners) fn(lastSyncError);
}

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
  const { data: existing, error: readErr } = await supabase
    .from(table)
    .select(idColumn)
    .eq("user_id", userId);
  if (readErr) throw readErr;

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
  if (rows.length > 0) {
    const { error } = await supabase.from(table).upsert(rows);
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
export async function pushKey(key: string, value: unknown): Promise<void> {
  const userId = currentUserId;
  if (!userId) return; // ログインしていなければ何もしない

  try {
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
        return;
      }
      case KEY.profile: {
        if (value === null) return; // プロフィールは明示的に消す操作が無い
        const { error } = await supabase
          .from("user_profiles")
          .upsert(profileToRow(value as UserProfile, userId));
        if (error) throw error;
        return;
      }
      case KEY.session: {
        if (value === null) return; // 「進行中を閉じた」だけ。行自体は消さない
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
        return;
      }
      case KEY.archive: {
        const sessions = value as Session[];
        if (sessions.length === 0) return;
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
        return;
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
        return;
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
        return;
      }
      case KEY.habitLogs: {
        await reconcileHabitLogs(userId, value as HabitLog[]);
        return;
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
        return;
      }
      default:
        // schemaVersion / variant / snapshots はローカルだけの関心事。同期しない
        return;
    }
  } catch (err) {
    noteFailure(`同期に失敗しました（${key}）`, err);
    await healIfDanglingReference(err);
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
    await backfillAll();
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
  if (!currentUserId) return { ok: false, pushed: [], failed: [] };
  const snap = captureState();
  const pushed: string[] = [];
  const failed: string[] = [];
  // sessions（archive）は big_stories/goal_cards が参照する session_id の先に
  // なるので、他より先に送る。順序を間違えるとFK違反で goal_cards が弾かれる
  const order = [KEY.session, KEY.archive, KEY.bigstory, KEY.cards, KEY.habits, KEY.habitLogs, KEY.timeboxes, KEY.profile];
  const keys = [...order.filter((k) => k in snap), ...Object.keys(snap).filter((k) => !order.includes(k as (typeof order)[number]))];

  for (const key of keys) {
    const raw = snap[key];
    if (raw === undefined) continue;
    const before = lastSyncError;
    try {
      await pushKey(key, JSON.parse(raw));
      if (lastSyncError === before) pushed.push(key);
      else failed.push(key);
    } catch (err) {
      noteFailure(`バックフィルに失敗しました（${key}）`, err);
      failed.push(key);
    }
  }
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
 * 何もしないと restoreState() の remove() だけが効いて、これらが
 * 無警告で消える（実際に「走行中の打刻が消える」形で見つかった不具合）。
 * クラウド由来のデータを詰める前に、いまの値をそのまま持ち越しておく。
 */
export async function pullAll(): Promise<boolean> {
  const userId = currentUserId;
  if (!userId) return false;
  const supabase = supabaseBrowser();

  try {
    const [big, profile, cards, habits, logs, boxes, sessions] = await Promise.all([
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
    ]);
    for (const r of [big, profile, cards, habits, logs, boxes, sessions]) {
      if (r.error) throw r.error;
    }

    // 未完了のうち一番新しいものを「進行中」とみなす。それ以外は archive
    const sessionRows = (sessions.data ?? []) as Record<string, unknown>[];
    const currentRow = sessionRows.find((r) => r.completed_at === null);
    const archiveRows = sessionRows.filter((r) => r !== currentRow);

    // この端末だけの値を、クラウド由来のデータで上書きされる前に確保しておく
    const local = captureState();
    const data: Record<string, string> = {};
    for (const k of [KEY.running, KEY.variant, KEY.schemaVersion]) {
      if (local[k] !== undefined) data[k] = local[k];
    }
    if (big.data) data[KEY.bigstory] = JSON.stringify(bigStoryFromRow(big.data));
    if (profile.data) data[KEY.profile] = JSON.stringify(profileFromRow(profile.data));
    data[KEY.cards] = JSON.stringify((cards.data ?? []).map(goalCardFromRow));
    data[KEY.habits] = JSON.stringify((habits.data ?? []).map(habitFromRow));
    data[KEY.habitLogs] = JSON.stringify((logs.data ?? []).map(habitLogFromRow));
    data[KEY.timeboxes] = JSON.stringify((boxes.data ?? []).map(timeBoxFromRow));
    if (currentRow) data[KEY.session] = JSON.stringify(sessionFromRow(currentRow));
    data[KEY.archive] = JSON.stringify(archiveRows.map(sessionFromRow));

    setSyncHook(null);
    const ok = restoreState(data);
    // 取り込み前に push が繋がっていたときだけ繋ぎ直す。
    // まだ向きが決まっていない段階で勝手に繋がないようにする
    if (pushEnabled) setSyncHook((key, value) => void pushKey(key, value));
    return ok;
  } catch (err) {
    noteFailure("クラウドからの取り込みに失敗しました", err);
    return false;
  }
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
    const inputs = {
      alreadySynced: readDeviceFlag(DEVICE_KEY.syncedUser) === userId,
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
        await backfillAll();
        if (currentUserId !== userId) return;
        setState({ kind: "ready" });
        return;
      }

      case "ready": {
        enablePush();
        writeDeviceFlag(DEVICE_KEY.syncedUser, userId);
        setState({ kind: "ready" });
        return;
      }

      case "conflict":
        // 本人が選ぶまで push は繋がない（勝手に片方を消さない）
        setState({ kind: "conflict" });
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
    if (!ok) {
      setState({ kind: "failed", message: "取り込みに失敗しました" });
      return false;
    }
  } else {
    setState({ kind: "pushing" });
    enablePush();
    const r = await backfillAll();
    if (!r.ok) {
      setState({ kind: "failed", message: "送信に一部失敗しました" });
      return false;
    }
  }

  writeDeviceFlag(DEVICE_KEY.syncedUser, userId);
  enablePush();
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
