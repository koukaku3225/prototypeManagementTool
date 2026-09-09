import type { GoalCard } from "@/types/goal";
import type { TimeBoxMeta } from "@/types/timebox";

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

// -------------------------------------- 対話の結果を「明日の一歩」の枠に落とす
/**
 * 対話で決まった明日の1件を、時間割の枠のメタ認知欄（why / obstacle / counter）に
 * 整える。
 *
 * これまで card/page.tsx がこの3項目をその場で組み立てていて、
 * **WOOP の障害と If-Then があるときは「どこでやるか」(where) が
 * counter に入らず捨てられていた**（`firstObstacle?.plan.if ? …If-Then… :
 * (t.where ? 場所 : "")` という二者択一になっていたため）。
 *
 * woop_wbs フェーズは「『家で』なら『家のどこですか』まで具体にする」と
 * 明記して場所を問い直す設計（prompts/phases.ts）で、当日に「どこでやるんだっけ」を
 * もう一度考えなくて済むようにするのが狙い。その成果を枠が捨てていた。
 *
 * 障害と場所は両立するので、両方を counter に残す（改行で区切る）。
 * where が無いときの出力は従来と変わらない。
 */
export function firstStepMeta(args: {
  /** rationale（大きな物語との関係）。空なら vision で代替する */
  rationale: string;
  vision: string;
  /** WOOP の先頭の障害。無ければ undefined */
  obstacle?: { text: string; plan: { if: string; then: string } };
  /** 本人が決めた場所。未取得なら null */
  where: string | null;
}): TimeBoxMeta {
  const ifThen = args.obstacle?.plan.if
    ? `もし${args.obstacle.plan.if} → ${args.obstacle.plan.then}`
    : "";
  const place = args.where?.trim() ? `場所: ${args.where.trim()}` : "";
  return {
    why: args.rationale || args.vision,
    obstacle: args.obstacle?.text ?? "",
    counter: [ifThen, place].filter(Boolean).join("\n"),
  };
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

// ------------------------------------------- 目標を消したときの巻き添えを言う
/**
 * 削除の確認文で「何が一緒に消えるか」を言う1文を作る。
 *
 * `deleteCard()` は目標だけでなく、紐づく予定・習慣・習慣の実施記録まで
 * 連鎖で消す。件数を出すようにはしてあったが、その習慣の数え方が
 * `habitsOfCard()`（＝畳んでいないものだけ）だったため、
 * **「やめた」習慣とその記録が数に入っていなかった**（レビューで指摘）。
 *
 * 畳んだ習慣は、このアプリが他の場所ではわざわざ守っているものである
 * （`archiveHabit` は消さずに畳む。「続かなかった」も記録で、消すと
 * 同じ失敗を繰り返したことに気づけない、という理由が storage.ts に書いてある）。
 * それが黙って巻き添えになるのは、確認文を出している意味を損なう。
 *
 * 数えるのは「実際に消える数」。そのうえで、畳んだぶんが含まれることを
 * 明示する（同じ数でも、消える中身の重みが違う）。
 */
export function deleteImpactText(args: {
  /** 紐づく予定の件数（完了済みも含む、実際に消える数） */
  boxes: number;
  /** 紐づく習慣の件数。やめた習慣も含めた、実際に消える数 */
  habits: number;
  /** そのうち「やめた」習慣の件数 */
  archivedHabits: number;
}): string | null {
  const parts: string[] = [];
  if (args.boxes > 0) parts.push(`予定${args.boxes}件`);
  if (args.habits > 0) {
    const note =
      args.archivedHabits > 0
        ? `やめた${args.archivedHabits}件と記録ごと`
        : "記録ごと";
    parts.push(`習慣${args.habits}件（${note}）`);
  }
  if (parts.length === 0) return null;
  return `紐づく${parts.join("・")}も一緒に消えます。`;
}
