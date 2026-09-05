import type { GoalCard } from "@/types/goal";

/**
 * 目標カードの短い表示名。
 *
 * TimeBoxSheet / RunningBar の「どの目標のためか」選択肢は、目標が2つ以上に
 * なった瞬間に vision.refined の長文がそのまま並び、どれがどれか読み比べないと
 * わからなくなる。label があればそれを使い、無い古いデータは vision を
 * 短く切り詰めて代用する（見た目のフォールバックであって、保存はしない）。
 */
export function goalCardLabel(card: GoalCard): string {
  const label = card.label?.trim();
  if (label) return label;

  const text = card.vision.refined || card.vision.raw;
  if (!text) return "（未記入の目標）";

  const MAX = 14;
  return text.length > MAX ? `${text.slice(0, MAX)}…` : text;
}
