import type { TokenUsage } from "@/types/goal";

/**
 * モデル別の単価（USD / 100万トークン）。
 *
 * 値は手で写したもので、公式の値上げ・値下げには追随しない。
 * 計測画面の数字がおかしいと思ったら、まずここを疑うこと。
 * 目的は「絶対額を当てること」ではなく「施策の前後で比べること」。
 */
export interface Price {
  input: number;
  output: number;
}

export const PRICE_PER_MTOK: Record<string, Price> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
};

/** 未知のモデルは haiku 相当で見積もる（0円にすると気づけないため） */
const FALLBACK: Price = { input: 1, output: 5 };

/** キャッシュ読み出しは入力の 1/10 */
const CACHE_READ_RATE = 0.1;
/** キャッシュ書き込みは 1h TTL で入力の2倍（5m なら 1.25 倍） */
const CACHE_WRITE_RATE = 2;

/** 1件のトークン使用量を USD に換算する */
export function usdOf(u: TokenUsage): number {
  const p = PRICE_PER_MTOK[u.model] ?? FALLBACK;
  const m = 1_000_000;
  return (
    (u.input * p.input) / m +
    (u.cacheRead * p.input * CACHE_READ_RATE) / m +
    (u.cacheWrite * p.input * CACHE_WRITE_RATE) / m +
    (u.output * p.output) / m
  );
}

export const USD_JPY = 155;

export const yenOf = (usd: number): number => usd * USD_JPY;

/**
 * キャッシュがまったく効かなかった場合の USD。
 * 「効いている」ことを示すには、この反実仮想と比べるしかない。
 * cacheRead / cacheWrite のトークンを、すべて定価の入力として数え直す。
 */
export function usdWithoutCache(u: TokenUsage): number {
  const p = PRICE_PER_MTOK[u.model] ?? FALLBACK;
  const m = 1_000_000;
  return (
    ((u.input + u.cacheRead + u.cacheWrite) * p.input) / m +
    (u.output * p.output) / m
  );
}
