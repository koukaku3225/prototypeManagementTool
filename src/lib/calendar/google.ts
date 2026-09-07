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
