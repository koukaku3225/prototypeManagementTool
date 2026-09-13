import { isEvaluated, isPeriodOver } from "@/lib/checkpoint";
import { diffDays, toLocalDate } from "@/lib/date";
import { computeRate } from "@/lib/habit";
import type { Habit, HabitLog } from "@/types/behavior";
import type { Checkpoint, GoalCard } from "@/types/goal";

/**
 * 目標の森（/goals の森表示と、/goal/[id] の1本の木）に渡すデータ。
 *
 * 見た目の決め事（2026-09-13 シミュレーターで竜一さんと合意）:
 *   - 木1本 = 目標。小枝 = 中間目標。葉 = 習慣の続き具合。根 = 価値観
 *   - 小枝が生えるのは中間目標を「足したとき」だけ。進み具合では伸ばさない。
 *     進み具合で伸ばすと、手が止まった週に木が枯れたように見えて責める見た目になる
 *   - 進み具合は 芽（期間中）→ 花（完了）→ 実（目標を完了）で見せる
 *   - 「今回は終わりにする」は落ち葉。失敗ではなく土に還るものとして扱う
 *   - 価値観との紐付けは、中間目標の「たて方を評価する」で選んだ linkedValues を集計する。
 *     目標そのものに価値観の欄は足さない（今あるデータだけで動かす）
 */

export const MAX_TREES = 6;
const MAX_TWIGS = 12;
/** この日数で木が大人の大きさになる */
const FULL_GROWTH_DAYS = 112;
/** 習慣の率を信用し始める予定日数。少ないうちの率は偶然に振れる */
const MIN_SCHEDULED_FOR_RATE = 3;

export type TwigState = "bud" | "open" | "flower" | "fallen";

export interface ForestTwig {
  id: string;
  title: string;
  state: TwigState;
  /** 0.15〜1。始まってからの日数で決まる、小枝の育ち具合 */
  maturity: number;
  /** values の添字 */
  values: number[];
}

export interface ForestTree {
  cardId: string;
  label: string;
  done: boolean;
  ageDays: number;
  /** 0.3〜1 */
  growth: number;
  /** 0〜1。葉の量と色 */
  vigor: number;
  twigs: ForestTwig[];
  /** この木がつながっている根（values の添字、昇順） */
  links: number[];
}

export interface ForestModel {
  values: string[];
  trees: ForestTree[];
  /** 根ごとの養分。その価値観を選んだ中間目標の数 */
  strength: number[];
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export function twigState(c: Checkpoint, today: string): TwigState {
  if (c.status === "done") return "flower";
  if (c.status === "abandoned") return "fallen";
  return isPeriodOver(c, today) ? "open" : "bud";
}

/**
 * 習慣の続き具合（0〜1）。
 * 率が出せる習慣が1つも無いときは中立の値を返す。始めたばかりの目標の葉を
 * 黄ばませると、まだ何も失敗していないのに責める見た目になる
 */
export function habitVigor(habits: Habit[], logs: HabitLog[], today: string): number {
  const rates = habits
    .map((h) => computeRate(h, logs, today))
    .filter((r) => r.scheduled >= MIN_SCHEDULED_FOR_RATE)
    .map((r) => r.rate);
  if (rates.length === 0) return habits.length > 0 ? 0.6 : 0.5;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

export function buildForest(input: {
  values: string[];
  cards: GoalCard[];
  checkpoints: Record<string, Checkpoint[]>;
  habits: Record<string, Habit[]>;
  logs: HabitLog[];
  today: string;
}): ForestModel {
  const { values, today } = input;
  const byCreated = (a: GoalCard, b: GoalCard) => a.createdAt.localeCompare(b.createdAt);
  const active = input.cards.filter((c) => (c.status ?? "active") !== "done").sort(byCreated);
  const done = input.cards
    .filter((c) => c.status === "done")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const cards = [...active, ...done].slice(0, MAX_TREES);

  const strength = values.map(() => 0);

  const trees = cards.map((card): ForestTree => {
    const ageDays = Math.max(0, diffDays(toLocalDate(new Date(card.createdAt)), today));
    const isDone = card.status === "done";

    const twigs = [...(input.checkpoints[card.id] ?? [])]
      .sort((a, b) => a.period.start.localeCompare(b.period.start) || a.createdAt.localeCompare(b.createdAt))
      .slice(-MAX_TWIGS)
      .map((c): ForestTwig => {
        const linked = isEvaluated(c.evaluation)
          ? c.evaluation.linkedValues.map((v) => values.indexOf(v)).filter((i) => i >= 0)
          : [];
        const uniq = [...new Set(linked)].sort((a, b) => a - b);
        uniq.forEach((i) => strength[i]++);
        return {
          id: c.id,
          title: c.title,
          state: twigState(c, today),
          maturity: clamp(diffDays(c.period.start, today) / 35, 0.15, 1),
          values: uniq,
        };
      });

    const links = [...new Set(twigs.flatMap((t) => t.values))].sort((a, b) => a - b);

    return {
      cardId: card.id,
      label: goalLabel(card),
      done: isDone,
      ageDays,
      growth: clamp(0.3 + ageDays / FULL_GROWTH_DAYS, 0.3, 1),
      vigor: isDone ? 0.7 : habitVigor(input.habits[card.id] ?? [], input.logs, today),
      twigs,
      links,
    };
  });

  return { values, trees, strength };
}

/** 森のラベル用の、goalCardLabel よりさらに短い名前 */
function goalLabel(card: GoalCard): string {
  const text = card.label?.trim() || card.vision.refined || card.vision.raw || "（未記入）";
  const MAX = 8;
  return text.length > MAX ? `${text.slice(0, MAX)}…` : text;
}

/** 木の中身の数。一覧のパネルに出す */
export function treeCounts(t: ForestTree) {
  return {
    buds: t.twigs.filter((w) => w.state === "bud").length,
    flowers: t.twigs.filter((w) => w.state === "flower").length,
    fallen: t.twigs.filter((w) => w.state === "fallen").length,
  };
}
