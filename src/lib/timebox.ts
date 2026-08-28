import type { TimeBox } from "@/types/timebox";

/**
 * タイムボックスの計算。
 *
 * 位置の出し方も重なりの詰め方も Google カレンダーに合わせてある。
 * 見慣れた動きから外れると、それだけで「使いにくい」と感じるため。
 *   - 位置  top = (開始分 / 1440) × 全高
 *   - 刻み  15分
 *   - 重なり 貪欲な列詰め。3件重なれば各33%幅
 *
 * ぜんぶ純粋関数。時刻の計算は目で見て正しさが分からないので、
 * tests/timebox.test.mjs で固定してある。
 */

/** 1日の分数 */
export const DAY_MINUTES = 1440;
/** 刻み。Google カレンダーと同じ15分 */
export const SNAP_MINUTES = 15;
/** 空きスロットをタップしたときに作る枠の長さ */
export const DEFAULT_DURATION = 30;

/**
 * "20:30" → 1230。妥当でなければ null。
 *
 * "24:00" だけは 1440 として受ける。toTime(1440) がこれを作るので、
 * 受け付けないと「自分で作った値を自分で読めない」ことになる。
 * その場合、24時に終わる枠は長さ0として扱われ、重なり判定からも漏れ、
 * グリッド上で最小の高さに潰れる（テストで見つけた）。
 * 25:00 のような本当に範囲外のものは、これまでどおり弾く。
 */
export function toMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return DAY_MINUTES;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 1230 → "20:30"。1440以上は 24:00 に丸める（日をまたがせない） */
export function toTime(minutes: number): string {
  const v = Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes)));
  const h = Math.floor(v / 60);
  const m = v % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 15分刻みに丸める */
export const snap = (minutes: number, step = SNAP_MINUTES): number =>
  Math.round(minutes / step) * step;

/** 枠の長さ（分）。壊れた時刻なら 0 */
export function durationMin(box: Pick<TimeBox, "start" | "end">): number {
  const s = toMinutes(box.start);
  const e = toMinutes(box.end);
  if (s === null || e === null) return 0;
  return Math.max(0, e - s);
}

/** 2つの枠が時間的に重なるか。境界が接するだけ（20:30終わり／20:30始まり）は重ならない */
export function overlaps(
  a: Pick<TimeBox, "start" | "end">,
  b: Pick<TimeBox, "start" | "end">,
): boolean {
  const as = toMinutes(a.start);
  const ae = toMinutes(a.end);
  const bs = toMinutes(b.start);
  const be = toMinutes(b.end);
  if (as === null || ae === null || bs === null || be === null) return false;
  return as < be && bs < ae;
}

export interface PlacedBox {
  box: TimeBox;
  /** 上からの位置（0〜1） */
  top: number;
  /** 高さ（0〜1）。潰れて見えなくならないよう下限を持つ */
  height: number;
  /** 何列目か（0始まり） */
  col: number;
  /** その重なりグループの列数 */
  cols: number;
}

/**
 * 重なりを列に詰める（貪欲）。
 *
 * 1. 開始順に並べる
 * 2. 重なりが途切れたところでグループを切る
 * 3. 各枠を「空いている最初の列」に入れる
 * 4. 幅 = 1/列数、左 = 列番号/列数
 */
export function layout(boxes: TimeBox[]): PlacedBox[] {
  const sorted = [...boxes].sort((a, b) => {
    const d = (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0);
    return d !== 0 ? d : (toMinutes(a.end) ?? 0) - (toMinutes(b.end) ?? 0);
  });

  const out: PlacedBox[] = [];
  let group: TimeBox[] = [];
  let groupEnd = -1;

  const flush = () => {
    if (group.length === 0) return;
    /** 列ごとの「その列が空く時刻」 */
    const colEnds: number[] = [];
    const assigned = group.map((b) => {
      const s = toMinutes(b.start) ?? 0;
      const e = toMinutes(b.end) ?? 0;
      let col = colEnds.findIndex((end) => end <= s);
      if (col === -1) {
        col = colEnds.length;
        colEnds.push(e);
      } else {
        colEnds[col] = e;
      }
      return { box: b, col };
    });
    const cols = colEnds.length;
    for (const { box, col } of assigned) {
      const s = toMinutes(box.start) ?? 0;
      const e = toMinutes(box.end) ?? 0;
      out.push({
        box,
        top: s / DAY_MINUTES,
        // 15分の枠でも文字が置けるだけの高さを残す
        height: Math.max((e - s) / DAY_MINUTES, 20 / DAY_MINUTES),
        col,
        cols,
      });
    }
    group = [];
    groupEnd = -1;
  };

  for (const b of sorted) {
    const s = toMinutes(b.start) ?? 0;
    const e = toMinutes(b.end) ?? 0;
    if (group.length > 0 && s >= groupEnd) flush();
    group.push(b);
    groupEnd = Math.max(groupEnd, e);
  }
  flush();

  return out;
}

/** いま進行中の枠。複数あれば最も早く始まったもの */
export function currentBox(boxes: TimeBox[], nowMinutes: number): TimeBox | null {
  const running = boxes
    .filter((b) => {
      const s = toMinutes(b.start);
      const e = toMinutes(b.end);
      return s !== null && e !== null && s <= nowMinutes && nowMinutes < e;
    })
    .sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));
  return running[0] ?? null;
}

/**
 * 次に始まる枠。
 * withinMinutes を指定すると、その時間内に始まるものだけ返す。
 */
export function nextBox(
  boxes: TimeBox[],
  nowMinutes: number,
  withinMinutes = Infinity,
): TimeBox | null {
  const upcoming = boxes
    .filter((b) => {
      const s = toMinutes(b.start);
      return s !== null && s > nowMinutes && s - nowMinutes <= withinMinutes;
    })
    .sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));
  return upcoming[0] ?? null;
}

/**
 * 空きスロットをタップしたときの新しい枠の時刻。
 * 15分に丸め、日をまたがないように末尾で押し戻す。
 */
export function slotAt(
  minutes: number,
  duration = DEFAULT_DURATION,
): { start: string; end: string } {
  let s = snap(Math.max(0, minutes));
  if (s + duration > DAY_MINUTES) s = DAY_MINUTES - duration;
  return { start: toTime(s), end: toTime(s + duration) };
}

/**
 * 開始・終了を妥当な形に正す。
 * 終了が開始以前なら、開始 + 15分 に押し出す。壊れた値は空文字で返さない。
 */
export function normalizeRange(
  start: string,
  end: string,
): { start: string; end: string } {
  const s = toMinutes(start) ?? 0;
  let e = toMinutes(end) ?? s + DEFAULT_DURATION;
  if (e <= s) e = Math.min(DAY_MINUTES, s + SNAP_MINUTES);
  return { start: toTime(s), end: toTime(e) };
}

/** その日の合計時間（分）。完了ぶんだけ数えることもできる */
export function totalMinutes(boxes: TimeBox[], onlyDone = false): number {
  return boxes
    .filter((b) => (onlyDone ? Boolean(b.completedAt) : true))
    .reduce((sum, b) => sum + durationMin(b), 0);
}

/** "1時間30分" のような表示。0分なら "0分" */
export function humanDuration(min: number): string {
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

// ---------------------------------------------------------------- 色

/**
 * 枠の色。
 *
 * 目標ごとに色が付くと、1日の時間の使い方が形で分かる
 * （「今日は全部この目標に使った」「あの目標に一度も触れていない」）。
 * 名前で持つのは、CSSトークン側で明暗の両テーマを面倒みるため。
 */
export const BOX_COLORS = [
  "amber",
  "indigo",
  "teal",
  "rose",
  "violet",
  "slate",
] as const;
export type BoxColor = (typeof BOX_COLORS)[number];

export const COLOR_LABEL: Record<BoxColor, string> = {
  amber: "山吹",
  indigo: "藍",
  teal: "青緑",
  rose: "紅",
  violet: "菫",
  slate: "鼠",
};

/**
 * 目標IDから色を決める。同じ目標はいつも同じ色になる。
 * 手で選ばせないのは、予定を作るたびに色を選ぶのは手数だから。
 */
export function colorForCard(cardId: string | null): BoxColor {
  if (!cardId) return "slate";
  let h = 0;
  for (let i = 0; i < cardId.length; i++) h = (h * 31 + cardId.charCodeAt(i)) >>> 0;
  // 鼠は「紐づけない」用に取ってあるので、それ以外から選ぶ
  const pool = BOX_COLORS.filter((c) => c !== "slate");
  return pool[h % pool.length];
}

/** 実際に使う色。手で決めた色が優先 */
export function colorOf(box: Pick<TimeBox, "color" | "cardId">): BoxColor {
  if (box.color && (BOX_COLORS as readonly string[]).includes(box.color)) {
    return box.color as BoxColor;
  }
  return colorForCard(box.cardId);
}

// ---------------------------------------------------------------- ドラッグ

/** 動かせる最小の長さ。これ未満には縮められない */
export const MIN_DURATION = SNAP_MINUTES;

/**
 * 枠を動かす。長さを保ったまま、日の中に収める。
 * つまみの位置ではなく「つかんだ場所からの相対」で動かすので、
 * 枠の途中をつかんでも飛ばない。
 */
export function moveBox(
  box: Pick<TimeBox, "start" | "end">,
  deltaMinutes: number,
): { start: string; end: string } {
  const s = toMinutes(box.start) ?? 0;
  const e = toMinutes(box.end) ?? s + DEFAULT_DURATION;
  const len = e - s;
  let ns = snap(s + deltaMinutes);
  // 端で潰さない。長さを保ったまま押し戻す
  ns = Math.max(0, Math.min(DAY_MINUTES - len, ns));
  return { start: toTime(ns), end: toTime(ns + len) };
}

/**
 * 上端／下端を引いて長さを変える。
 * 上を下げすぎたり下を上げすぎたりしても、反転させず最小の長さで止める。
 */
export function resizeBox(
  box: Pick<TimeBox, "start" | "end">,
  edge: "start" | "end",
  deltaMinutes: number,
): { start: string; end: string } {
  const s = toMinutes(box.start) ?? 0;
  const e = toMinutes(box.end) ?? s + DEFAULT_DURATION;
  if (edge === "start") {
    let ns = snap(s + deltaMinutes);
    ns = Math.max(0, Math.min(e - MIN_DURATION, ns));
    return { start: toTime(ns), end: toTime(e) };
  }
  let ne = snap(e + deltaMinutes);
  ne = Math.min(DAY_MINUTES, Math.max(s + MIN_DURATION, ne));
  return { start: toTime(s), end: toTime(ne) };
}

/**
 * 空きを引いて作るときの範囲。
 * 上向きに引いても成立させる（始点より前で離しても、そこが開始になる）。
 */
export function dragRange(
  fromMinutes: number,
  toMinutes_: number,
): { start: string; end: string } {
  const a = snap(Math.max(0, Math.min(DAY_MINUTES, fromMinutes)));
  const b = snap(Math.max(0, Math.min(DAY_MINUTES, toMinutes_)));
  let s = Math.min(a, b);
  let e = Math.max(a, b);
  if (e - s < MIN_DURATION) e = s + MIN_DURATION;
  if (e > DAY_MINUTES) {
    e = DAY_MINUTES;
    s = Math.min(s, DAY_MINUTES - MIN_DURATION);
  }
  return { start: toTime(s), end: toTime(e) };
}

/**
 * 同じ日に複製したときの置き場所。
 * 元の直後に置く。重ねて置くと、複製したことに気づきにくい。
 */
export function duplicateSlot(
  box: Pick<TimeBox, "start" | "end">,
): { start: string; end: string } {
  const len = durationMin(box) || DEFAULT_DURATION;
  const e = toMinutes(box.end) ?? 0;
  if (e + len <= DAY_MINUTES) return { start: toTime(e), end: toTime(e + len) };
  // 後ろに入らなければ前へ
  const s = toMinutes(box.start) ?? 0;
  const ns = Math.max(0, s - len);
  return { start: toTime(ns), end: toTime(ns + len) };
}

/**
 * いまの時刻から始まる枠。
 *
 * ＋ボタンで作るときに使う。「いま何をやるか決める」が一番多い使い方なので、
 * 何も指定しなければ現在時刻をタイムボックスの開始時刻にする。
 * 15分に切り下げるのは、いまの時間帯そのものを押さえたいため
 * （切り上げると、いま始めた作業が枠の外に出てしまう）。
 */
export function slotFromNow(
  nowMinutes: number,
  duration = DEFAULT_DURATION,
): { start: string; end: string } {
  const s = Math.max(0, Math.floor(nowMinutes / SNAP_MINUTES) * SNAP_MINUTES);
  return slotAt(s, duration);
}
