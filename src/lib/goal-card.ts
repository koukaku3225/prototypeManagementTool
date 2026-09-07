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

// -------------------------------------------------------------- 未保存の下書き
/*
 * 「手入力でつくる」を押した瞬間に空のカードを保存していたため、
 * 押しただけで中身の無い目標が1枠（最大3つ）を占めてしまっていた
 * （レビューで指摘）。TimeBoxSheet が「この時間に入れる」を押すまで
 * 枠を作らないのと同じ考え方で、/goal/new から /goal/[id] へ渡す間だけ
 * sessionStorage に置き、最初の入力があったときに初めて upsertCard で
 * 永続化する。タブを閉じれば自動で消える（sessionStorage の性質どおり）。
 */
const PENDING_PREFIX = "gc.pendingCard.";

/** 下書きを一時置き場に置く。使えない環境（プライベートモード等）では諦める */
export function stashPendingCard(card: GoalCard): boolean {
  try {
    sessionStorage.setItem(PENDING_PREFIX + card.id, JSON.stringify(card));
    return true;
  } catch {
    return false;
  }
}

/**
 * 下書きを覗く。置き場からは消さない。無ければ null。
 *
 * 読んだ時点で消すと、React の StrictMode（開発時は effect が2回走る）で
 * 2回目に null が返り、「目標が見つかりませんでした」に落ちる。
 * 消すのは「本人が最初の項目を書いて永続化できたとき」だけにする
 * （clearPendingCard）。消し忘れてもタブを閉じれば消える。
 */
export function peekPendingCard(id: string): GoalCard | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PREFIX + id);
    if (!raw) return null;
    return JSON.parse(raw) as GoalCard;
  } catch {
    return null;
  }
}

/** 下書きを置き場から消す。永続化できたあとに呼ぶ */
export function clearPendingCard(id: string): void {
  try {
    sessionStorage.removeItem(PENDING_PREFIX + id);
  } catch {
    /* 使えない環境では、そもそも置けていない */
  }
}

// ------------------------------------------------ 「どの目標のためか」の選択肢
/**
 * 予定シートの目標プルダウンに並べるもの。
 *
 * これまでは進行中の目標だけを `<option>` にしていた。すると、目標を完了に
 * したあとにその目標の予定を開くと、`value` に対応する `<option>` が無くなり、
 * ブラウザが先頭（＝「（紐づけない）」）を選択状態として描く。
 * **画面は「紐づけない」なのに、保存されている cardId は紐づいたまま**という
 * 食い違いが起き、しかも本人には直しようがない（選択肢に出てこないため）。
 *
 * そこで「いま紐づいている目標」だけは、完了していても、
 * 一覧から消えていても必ず選択肢に残す。完了済みだと分かる書き方にして、
 * 外したい人は「（紐づけない）」を選べばよい状態にする。
 *
 * 渡す `cards` は**絞り込まない全件**でよい。進行中かどうかはここで見る。
 */
export type GoalOption = { id: string; label: string };

export function goalSelectOptions(
  cards: GoalCard[],
  currentId: string | null,
): GoalOption[] {
  const options = cards
    .filter((c) => (c.status ?? "active") !== "done")
    .map((c) => ({ id: c.id, label: goalCardLabel(c) }));

  if (currentId && !options.some((o) => o.id === currentId)) {
    const found = cards.find((c) => c.id === currentId);
    options.push({
      id: currentId,
      // 見つからないのは、目標だけ消えて予定が残った古いデータのとき
      label: found ? `${goalCardLabel(found)}（完了）` : "（削除された目標）",
    });
  }

  return options;
}

// -------------------------------------- 目標から時間割へ来たときの引き継ぎ
/**
 * `/plan?card=<id>` で渡された目標。
 *
 * 目標画面の「時間割で予定を作る →」は素の `/plan` へ飛ばしていたので、
 * その目標のために時間を取りに来たのに、予定を作ると「（紐づけない）」から
 * 選び直す必要があった。目標 → 予定 はこのアプリの中心の導線なので、
 * ここで切れると「決めた目標」と「実際に押さえた時間」が繋がらない。
 *
 * 実在しないid・完了済みの目標は無視する（URLは書き換えられるし、
 * 目標を完了にしたあとに古いリンクを踏むこともある）。
 */
export function presetCardIdFrom(
  search: string,
  cards: GoalCard[],
): string | null {
  let id: string | null = null;
  try {
    id = new URLSearchParams(search).get("card");
  } catch {
    return null;
  }
  if (!id) return null;

  const found = cards.find((c) => c.id === id);
  if (!found || (found.status ?? "active") === "done") return null;
  return found.id;
}
