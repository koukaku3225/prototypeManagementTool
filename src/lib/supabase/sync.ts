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
import { captureState, KEY, restoreState, setSyncHook } from "@/lib/storage";
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

function noteFailure(context: string, err: unknown) {
  lastSyncError = {
    at: new Date().toISOString(),
    message: `${context}: ${err instanceof Error ? err.message : String(err)}`,
  };
  // 同期は保険。落ちてもコンソールに残すだけで、ユーザー操作は止めない
  console.warn("[supabase sync]", lastSyncError.message);
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

  if (gone.length > 0) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("user_id", userId)
      .in(idColumn, gone);
    if (error) throw error;
  }
  if (rows.length > 0) {
    const { error } = await supabase.from(table).upsert(rows);
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

    const data: Record<string, string> = {};
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
    setSyncHook(userId ? (key, value) => void pushKey(key, value) : null);
    return ok;
  } catch (err) {
    noteFailure("クラウドからの取り込みに失敗しました", err);
    return false;
  }
}

/**
 * ログイン状態が変わったときに呼ぶ。
 * userId が付けば以後の write() が裏で同期されるようになり、
 * null に戻せば同期が止まる（サインアウト時）。
 */
export function setSyncUser(userId: string | null): void {
  currentUserId = userId;
  setSyncHook(userId ? (key, value) => void pushKey(key, value) : null);
}
