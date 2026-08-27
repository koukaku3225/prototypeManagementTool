import type { GoalCard } from "@/types/goal";
import { COACHES } from "@/lib/prompts/coaches";

const MOTIVATION_LABEL = {
  internal: "内発的（やりたいから）",
  external: "外発的（評価・報酬のため）",
  avoidance: "回避的（避けたいから）",
} as const;

export function toMarkdown(card: GoalCard): string {
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push(`# ${card.vision.refined || card.vision.raw}`);
  push();
  push(
    `作成日: ${card.createdAt.slice(0, 10)} / コーチ: ${COACHES[card.coachId].name}`,
  );
  push();

  push("## なりたい姿");
  push();
  push(card.vision.refined || card.vision.raw);
  if (card.vision.raw && card.vision.refined !== card.vision.raw) {
    push();
    push(`> 最初の言葉: ${card.vision.raw}`);
  }
  push();

  push("## これが大事な理由");
  push();
  for (const why of card.meaning.whyChain) push(`- ${why}`);
  if (card.meaning.values.length) {
    push();
    push(`大事にしているもの: ${card.meaning.values.join(" / ")}`);
  }
  push();
  push(`動機の種類: ${MOTIVATION_LABEL[card.meaning.motivationType]}`);
  if (card.meaning.reframedFrom && card.meaning.reframed) {
    push();
    push(`言い換え: ${card.meaning.reframedFrom} → ${card.meaning.reframed}`);
  }
  push();

  push("## 目標");
  push();
  push(`- 何を: ${card.smart.specific}`);
  push(`- どれくらい: ${card.smart.measurable}`);
  push(`- いつまでに: ${card.smart.deadline ?? "（未定）"}`);
  if (card.smart.achievableNote) push(`- 現実性: ${card.smart.achievableNote}`);
  push();

  if (card.woop.obstacles.length) {
    push("## つまずきそうなこと と 対策");
    push();
    for (const o of card.woop.obstacles) {
      push(`### ${o.text}`);
      push();
      if (o.situation) push(`起きる状況: ${o.situation}`);
      push(`もし **${o.plan.if}** → **${o.plan.then}**`);
      push();
    }
  }

  push("## 明日やること");
  push();
  for (const t of card.tasks) {
    // 「いつ・どこで」は書き出しでも本文に残す。ここが実行意図の本体で、
    // やること だけ持ち帰っても当日にもう一度考え直すことになる
    const when = [t.startTime, t.where].filter(Boolean).join(" ");
    const head = when ? `${when} ・ ` : "";
    push(
      `- [${t.completedAt ? "x" : " "}] ${head}${t.title}（${t.estimateMin}分 / ${t.dueDate}）`,
    );
  }
  push();

  if (card.commitment.userWords) {
    push("## 約束");
    push();
    push(`> ${card.commitment.userWords}`);
    push();
  }

  return lines.join("\n");
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
