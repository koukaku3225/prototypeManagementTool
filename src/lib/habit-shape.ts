/**
 * 習慣の「作る形」の判断（D1 習慣の型・D2 2分チェック・D4 摩擦の診断）。
 * I/O を持たない。画面（HabitEditor）と保存・同期（mappers）から使う。
 *
 * ■ 方針
 *   - どれも任意。判定が「大きい」「手順が多い」でも、保存は止めない。案内を出すだけ
 *   - 責める言い方をしない。「疲れた日には重いかもしれません」のように、できない日の側に立つ
 */

// ---------------------------------------------------------------- D1 祝い

/** 祝いの選択肢（1タップ）。自由入力も別に持つ */
export const CELEBRATION_PRESETS = [
  "「よし」と言う",
  "ガッツポーズ",
  "好きな飲み物",
] as const;

const CELEBRATION_MAX = 60;

/** 祝いの保存値。空・空白だけ・文字列でないものは null（未設定） */
export function normalizeCelebration(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, CELEBRATION_MAX).trim();
  return s ? s : null;
}

// ---------------------------------------------------------------- D2 最小版の大きさ

/** 最小版として長すぎそうな文字数。「机に座って、1行だけ書く」は12文字 */
const LONG_TEXT = 25;
/** 「2分以内」が最小版の目安。これを超える時間は大きいとみなす */
const MAX_MINUTES = 2;

const KANJI_DIGIT: Record<string, number> = {
  〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 「十」「二十」「三十五」「百」などの漢数字（〜999）を数にする。読めなければ null */
function parseKanji(s: string): number | null {
  if (!/^[〇一二三四五六七八九十百]+$/.test(s)) return null;
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch === "百") {
      total += (cur || 1) * 100;
      cur = 0;
    } else if (ch === "十") {
      total += (cur || 1) * 10;
      cur = 0;
    } else {
      cur = cur * 10 + KANJI_DIGIT[ch];
    }
  }
  return total + cur;
}

function toNumber(s: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return parseKanji(s);
}

const NUM = String.raw`(\d+(?:\.\d+)?|[〇一二三四五六七八九十百]+)`;
const MIN_RE = new RegExp(String.raw`${NUM}\s*(?:分|min(?:ute)?s?)`, "gi");
const HOUR_RE = new RegExp(String.raw`${NUM}\s*(?:時間|hours?|hrs?|h(?![a-z]))`, "gi");
const HALF_RE = /半時間|半日|丸一日|まる一日/g;

export interface MinimalSizeCheck {
  tooBig: boolean;
  /** time=時間を表す語がある / length=文が長い / null=大きくない */
  reason: "time" | "length" | null;
}

/**
 * 最小版が大きすぎそうか。
 * 「2分で終わる形」が目安なので、3分以上を表す語、または長い文を大きいとみなす。
 */
export function minimalSizeCheck(text: string): MinimalSizeCheck {
  const s = text.normalize("NFKC").trim();
  if (!s) return { tooBig: false, reason: null };

  for (const m of s.matchAll(MIN_RE)) {
    // 「十分に」「十分な」「十分です」は「じゅうぶん」。時間ではない
    const after = s.slice((m.index ?? 0) + m[0].length);
    if (m[1] === "十" && /^(?:に|な|です|だ(?!け))/.test(after)) continue;
    const n = toNumber(m[1]);
    if (n !== null && n > MAX_MINUTES) return { tooBig: true, reason: "time" };
  }
  for (const m of s.matchAll(HOUR_RE)) {
    const n = toNumber(m[1]);
    if (n !== null && n * 60 > MAX_MINUTES) return { tooBig: true, reason: "time" };
  }
  if (HALF_RE.test(s)) {
    HALF_RE.lastIndex = 0;
    return { tooBig: true, reason: "time" };
  }
  HALF_RE.lastIndex = 0;

  if ([...s].length > LONG_TEXT) return { tooBig: true, reason: "length" };
  return { tooBig: false, reason: null };
}

/** 時間の語（「30分」「20分だけ」）を取り除いた、行動の芯 */
function stripTime(text: string): string {
  return text
    .normalize("NFKC")
    .replace(
      new RegExp(
        String.raw`${NUM}\s*(?:分間?|min(?:ute)?s?|時間|hours?|hrs?|h)(?:だけ|ほど|くらい|程度)?`,
        "gi",
      ),
      "",
    )
    .replace(/半時間|半日|丸一日|まる一日/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 「もっと小さくする」案。最大3つ。元の文字列と同じものは返さない。
 * 行動の芯が短く取り出せたときだけ、それを使った案を先頭に置く。
 */
export function shrinkOptions(text: string): string[] {
  const core = stripTime(text);
  const out: string[] = [];
  if (core && [...core].length <= 14) {
    out.push(`${core}（1分だけ）`);
    out.push(`${core}前の準備だけ`);
  } else {
    out.push("1分だけやる");
    out.push("道具を出すだけ");
  }
  out.push("最初の1つだけやる");
  const src = text.trim();
  return out.filter((x) => x !== src);
}

// ---------------------------------------------------------------- D4 摩擦

/** 「始めるまでの手順」の選択肢。4 は「4以上」 */
export const FRICTION_CHOICES: { value: number; label: string }[] = [
  { value: 0, label: "0" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4+" },
];

/** 手順が多いと判断する下限 */
export const HEAVY_FRICTION = 3;

/** 手順数の保存値。0〜4 の整数だけ通す（5以上は 4 = 4+ に丸める）。壊れた値は null */
export function normalizeFrictionSteps(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return null;
  return Math.min(v, 4);
}

export interface FrictionAdvice {
  heavy: boolean;
  message: string;
}

/** 手順が3以上のとき、減らす案を返す。未回答・少ないときは何も出さない */
export function frictionAdvice(steps: number | null | undefined): FrictionAdvice {
  const n = normalizeFrictionSteps(steps);
  if (n === null || n < HEAVY_FRICTION) return { heavy: false, message: "" };
  return {
    heavy: true,
    message:
      "手順が多いほど、始めるのが重くなります。道具を出しっぱなしにする、前の晩に準備しておく、" +
      "場所を変える、のどれかで、手順を1つ減らせないか見てみませんか。",
  };
}
