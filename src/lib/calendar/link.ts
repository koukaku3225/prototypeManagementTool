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
