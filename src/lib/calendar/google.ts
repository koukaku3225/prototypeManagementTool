/**
 * Google Calendar API の薄いラッパ。
 *
 * 公式SDKを入れず fetch で書くのは、使うのが数エンドポイントだけで、
 * 依存を1つ増やすほどの分量ではないため。
 *
 * スコープは2つに分けてある。
 *   - 書き込みは calendar.app.created（このアプリが作ったカレンダーだけ）
 *   - 読み取りは calendar.readonly（本人の全カレンダー）
 *
 * 「本人の予定を読めるが、絶対に書き換えられない」という形にしてある。
 *
 * ■ トークンが漏れたときに何が起きるか（2026-09-08 指摘3で更新）
 *
 * `calendar.readonly` を足す前は「漏れてもアプリの専用カレンダーしか
 * 見えない」と言えた。**いまは違う。** 保管している refresh_token は
 * **本人のすべてのカレンダーの全予定を読める鍵**である。
 * 書き換えられないのは今も正しいが、読まれないとは言えない。
 *
 * この前提でしか設計判断をしてはいけない（保管場所・RLS・ログ出力）。
 * スコープを増減したときは、この記述も必ず書き換えること。
 */

/**
 * 書き込みは「このアプリが作ったカレンダー」だけに閉じる権限。
 * 万一トークンが漏れても、本人のメインカレンダーは書き換えられない。
 */
export const CALENDAR_WRITE_SCOPE =
  "https://www.googleapis.com/auth/calendar.app.created";

/**
 * 本人の全カレンダーを**読むだけ**の権限。
 *
 * 時間割に本物の予定を重ねて表示するために足した。
 * これが無いと、アプリは自分が作ったカレンダーしか見えず、
 * 「アプリを開いても本当の予定が分からない」まま空き時間を判断できない。
 *
 * 読み取り専用なので、この権限でアプリが本人の予定を書き換えることはない。
 * 重ねて出すだけで、アプリ側にも保存しない（下記 overlay の経路）。
 */
export const CALENDAR_READ_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

export const CALENDAR_SCOPE = `${CALENDAR_WRITE_SCOPE} ${CALENDAR_READ_SCOPE}`;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

/**
 * Google が返したHTTPステータスを持ったまま投げるための例外。
 *
 * 素の Error だと、呼び出し側は「失敗した」しか分からない。
 * 401/403（＝権限が足りない・連携が切れた）と、通信障害や5xxを
 * 区別できないので、**再連携すれば直る失敗が「読めませんでした」に
 * 丸められて、本人が何をすればいいか分からなくなる**
 * （2026-09-08 指摘2の握りつぶし）。
 */
export class GoogleApiError extends Error {
  readonly status: number;
  /**
   * Google が本文で返した失敗の理由。取れなければ null。
   *
   * ステータスだけでは足りない。Google Calendar API は**レート制限も 403 で
   * 返す**（`rateLimitExceeded` / `userRateLimitExceeded`。429 に統一されて
   * いない）ので、403 を一律「権限不足」と読むと、混んだだけの一時的な失敗に
   * 「連携し直してください」という**再連携しても直らない案内**を出してしまう。
   * 逆に、再連携が本当に要る `invalid_grant` は OAuth の規約どおり **400** で
   * 来るので、ステータスだけ見ていると取りこぼす（RFC 6749 §5.2）。
   */
  readonly reason: string | null;
  constructor(status: number, message: string, reason: string | null = null) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.reason = reason;
  }
}

/**
 * 失敗レスポンスの本文から「理由」を取り出す。取れなければ null。
 *
 * 2つの形が来る。
 *   - Calendar API … `{"error":{"errors":[{"reason":"rateLimitExceeded"}],"status":"PERMISSION_DENIED"}}`
 *   - OAuth トークンendpoint … `{"error":"invalid_grant"}`
 *
 * 本文を読むのは `res.ok` が false のときだけ。読むとボディを消費するので、
 * 成功パスでは絶対に呼ばないこと。
 */
async function readErrorReason(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    const j = JSON.parse(text) as {
      error?:
        | string
        | { errors?: { reason?: string }[]; status?: string };
    };
    if (typeof j.error === "string") return j.error;
    const reason = j.error?.errors?.[0]?.reason;
    if (typeof reason === "string") return reason;
    if (typeof j.error?.status === "string") return j.error.status;
    return null;
  } catch {
    // JSON でない・途中で切れた。理由が分からないだけなので握って進む
    return null;
  }
}

/**
 * 403 で来るが、**再連携では直らない**理由。混雑・クォータ・一時的な不調。
 *
 * ここに載っているものだけを除外する（載っていない 403 は権限不足側に倒す）
 * のは、Google が権限不足を返すときの理由文字列が
 * `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT` /
 * `forbidden` と揺れており、許可リスト方式だと**本当に再連携が要る 403 を
 * 取りこぼす**ため。取りこぼしは「案内が出ない（従来と同じ）」で済むが、
 * 誤検知は「消えない嘘の案内が端末に焼き付く」ので、害の大きいほうを塞ぐ。
 */
const RETRYABLE_403_REASONS = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded",
  "dailyLimitExceeded",
  "variableTermExpiredDailyExceeded",
  "backendError",
  "RESOURCE_EXHAUSTED",
  "UNAVAILABLE",
  "INTERNAL",
]);

/**
 * ステータスに関係なく「本人が連携し直すまで直らない」ことを示す OAuth のエラー。
 *
 * `invalid_grant` は refresh_token が失効したとき（本人が Google 側で
 * アクセスを取り消した／長期間未使用で期限切れ）に返る。**再連携が要る
 * いちばんありふれた原因**でありながら、HTTP は 400 なので
 * ステータスだけの判定では拾えない。
 */
const RECONNECT_OAUTH_ERRORS = new Set(["invalid_grant"]);

/**
 * 「連携し直せば直る」失敗か。
 *
 * - `invalid_grant` … refresh_token が失効した。**HTTP は 400** で来る
 * - 401 … トークンが無効（本人がGoogle側で権限を取り消した等）
 * - 403 で、理由がレート制限・一時的な不調でないもの … 権限が足りない
 *   （insufficientPermissions）。OAuthで許可された権限は**同意した時点で
 *   refresh_token に固定される**ので、アプリ側の定数にスコープを足しても、
 *   既に連携済みの人には遡って付かない。本人がもう一度同意し直すまで、
 *   その機能は永久に動かない。
 *
 * いずれも本人の操作（再連携）でしか解けないので、必ず画面まで届ける。
 *
 * **逆に、ここで true にしてはいけないもの**がある。案内を受け取った画面は
 * `gc.calendarNeedsReconnect` を localStorage に書き、次に重ね表示が成功する
 * まで消さない。混雑による 403 を再連携扱いにすると、**再連携しても直らない
 * 案内が端末に居座る**（2026-09-10 レビュー指摘1）。
 */
export function needsReconnect(err: unknown): boolean {
  if (!(err instanceof GoogleApiError)) return false;
  if (err.reason && RECONNECT_OAUTH_ERRORS.has(err.reason)) return true;
  if (err.status === 401) return true;
  if (err.status !== 403) return false;
  return !(err.reason !== null && RETRYABLE_403_REASONS.has(err.reason));
}

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
  if (!res.ok) {
    /*
     * 本文の `error` を必ず拾う。失効した refresh_token は
     * `{"error":"invalid_grant"}` を **400** で返すので、ステータスだけでは
     * 「再連携が要る」といういちばんありふれた原因を取りこぼす。
     */
    const reason = await readErrorReason(res);
    throw new GoogleApiError(
      res.status,
      `アクセストークンを更新できませんでした (${res.status})`,
      reason,
    );
  }
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
    if (!res.ok) {
      throw new GoogleApiError(
        res.status,
        `予定を取得できませんでした (${res.status})`,
        await readErrorReason(res),
      );
    }

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

/** カレンダー一覧の1件。重ねて表示するのに要るぶんだけ */
export interface GoogleCalendarSummary {
  id: string;
  summary: string;
  /** 本人が非表示にしているカレンダーは重ねない */
  selected: boolean;
}

/**
 * 本人が持っているカレンダーの一覧。読み取り専用。
 *
 * 「重ねて表示する」ために、どのカレンダーを読むかを決める材料。
 * Googleカレンダー側で非表示にしているものはここでも重ねない
 * （向こうで消しているのにこちらで出るのは、本人の意思に反する）。
 */
export async function listCalendars(
  token: string,
): Promise<GoogleCalendarSummary[]> {
  const out: GoogleCalendarSummary[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ maxResults: "250", showHidden: "false" });
    if (pageToken) q.set("pageToken", pageToken);
    const res = await call(token, `/users/me/calendarList?${q}`);
    if (!res.ok) {
      throw new GoogleApiError(
        res.status,
        `カレンダー一覧を取得できませんでした (${res.status})`,
        await readErrorReason(res),
      );
    }
    const j = (await res.json()) as {
      items?: { id?: string; summary?: string; selected?: boolean }[];
      nextPageToken?: string;
    };
    for (const c of j.items ?? []) {
      if (!c.id) continue;
      out.push({
        id: c.id,
        summary: c.summary ?? "",
        // selected は「向こうの画面でチェックが入っているか」。
        // 省略されることがあり、その場合は表示扱いにする
        selected: c.selected !== false,
      });
    }
    pageToken = j.nextPageToken;
  } while (pageToken);
  return out;
}
