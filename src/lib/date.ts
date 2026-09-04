/**
 * ローカル日付のヘルパー。
 *
 * `new Date().toISOString().slice(0, 10)` は UTC の日付を返す。
 * JST では朝9時までが前日扱いになり、「今日やること」が深夜に消えたり、
 * 明日の日付が今日になったりする。日付を文字列で扱う箇所は必ずここを通す。
 *
 * 形式は ISO8601 の日付部分（YYYY-MM-DD）で統一する。
 * 既存データもこの形式なので、文字列の辞書順比較がそのまま日付の前後比較になる。
 */

/** Date をローカルタイムゾーンの YYYY-MM-DD にする */
export function toLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 今日（ローカル） */
export const today = (): string => toLocalDate(new Date());

/**
 * n日後（ローカル）。
 * `Date.now() + 86_400_000` は夏時間のある地域で1時間ずれるので使わない。
 */
export function addDays(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return toLocalDate(d);
}

/** 明日（ローカル） */
export const tomorrow = (): string => addDays(1);

/**
 * その週の月曜日（ローカル）。
 *
 * 日曜始まりにしない。「今週どれだけこの目標に使ったか」を見る用途なので、
 * 週末が週の真ん中で分断されると、土日にやったことが2週に割れて読みにくい。
 */
export function startOfWeek(from: Date = new Date()): string {
  const d = new Date(from);
  const dow = d.getDay(); // 0=日 … 6=土
  // 日曜は「前の週の月曜」まで6日戻る
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return toLocalDate(d);
}

/** その日付が今週（月曜〜日曜）に入っているか */
export function isThisWeek(date: string, from: Date = new Date()): boolean {
  if (!date) return false;
  const start = startOfWeek(from);
  const end = addDays(6, new Date(`${start}T00:00:00`));
  return date >= start && date <= end;
}

/** その日付が今日より前か。空文字は「期限なし」として false */
export const isOverdue = (date: string): boolean =>
  Boolean(date) && date < today();

/** その日付が今日以前か（＝今日やるべきか）。空文字は対象外 */
export const isDueBy = (date: string): boolean =>
  Boolean(date) && date <= today();

/**
 * 期限の残り日数を人間向けの一言にする。
 * 「今日」「明日」「3日遅れ」など。
 */
export function dueLabel(date: string): string {
  if (!date) return "期限なし";
  const t = today();
  if (date === t) return "今日";
  if (date === addDays(1)) return "明日";
  if (date < t) {
    const diff = diffDays(date, t);
    return `${diff}日遅れ`;
  }
  return date;
}

/** a から b までの日数。どちらも YYYY-MM-DD */
export function diffDays(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`);
  return Math.round(ms / 86_400_000);
}

/**
 * "21:00" のような時刻文字列を検証する。
 * 実行意図の「いつ」は入力が自由なので、保存前にここを通す。
 * 妥当でなければ null を返す（＝未設定として扱う）。
 */
export function normalizeTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2})[:：](\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
