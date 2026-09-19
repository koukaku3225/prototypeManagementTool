"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CheckpointEditor } from "@/components/CheckpointEditor";
import { CoachAvatar } from "@/components/CoachAvatar";
import { EditableField } from "@/components/EditableField";
import { GoalForest } from "@/components/GoalForest";
import { HabitEditor } from "@/components/HabitEditor";
import { COACHES } from "@/lib/prompts/coaches";
import { download, toMarkdown } from "@/lib/export";
import {
  deleteCard,
  allHabitsOfCard,
  checkpointsOfCard,
  habitsOfCard,
  loadHabitLogs,
  timeBoxesOfCard,
  loadBigStory,
  loadCardById,
  upsertCard,
} from "@/lib/storage";
import { deadlineCountdown, toLocalDate, today } from "@/lib/date";
import { buildForest } from "@/lib/forest";
import { clearPendingCard, deleteImpactText, peekPendingCard } from "@/lib/goal-card";
import type { BigStory, Checkpoint, GoalCard, Obstacle } from "@/types/goal";
import type { Habit, HabitLog } from "@/types/behavior";
import type { TimeBox } from "@/types/timebox";

/** 予定を最初に何件まで出すか。残りは「すべて見る」で開く */
const UPCOMING_LIMIT = 3;

/**
 * 目標の詳細と編集。
 * 以前は if-then と明日のタスクだけが編集できず、AIが取り出せなかったときに
 * 「自分で書いてください」と言われても書く手段がなかった。ここでは全項目を
 * 編集でき、障害もタスクも自分で足せる。
 *
 * 並びは「触る頻度」の順（2026-09-14）。縦に長く、毎日触る予定・習慣が
 * 一番下に埋もれていた。一度決めたら読み返さない大きな物語・理由と、
 * めったに使わない書き出し・削除は末尾に畳んである。
 */
export default function GoalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [card, setCard] = useState<GoalCard | null>(null);
  const [big, setBig] = useState<BigStory | null>(null);
  const [ready, setReady] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [habits, setHabits] = useState<Habit[]>([]);
  /*
   * 削除の確認文で数えるのは「実際に消える数」なので、畳んだ習慣も入る。
   * 画面に並べる habits（進行中だけ）とは別に持つ。
   */
  const [doomedHabits, setDoomedHabits] = useState<Habit[]>([]);
  const [boxes, setBoxes] = useState<TimeBox[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [showAllBoxes, setShowAllBoxes] = useState(false);
  const [bigTree, setBigTree] = useState(false);

  useEffect(() => {
    /*
     * /goal/new の「手入力でつくる」は、押した瞬間には保存していない
     * （goal-card.ts の stashPendingCard 参照）。まだ localStorage に無い
     * カードは、渡された下書きが無いか見てから初めて「見つからない」と判定する。
     */
    setCard(loadCardById(id) ?? peekPendingCard(id));
    setBig(loadBigStory());
    setHabits(habitsOfCard(id));
    setDoomedHabits(allHabitsOfCard(id));
    setBoxes(
      timeBoxesOfCard(id).sort(
        (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
      ),
    );
    setCheckpoints(checkpointsOfCard(id));
    setLogs(loadHabitLogs());
    setReady(true);
  }, [id]);

  const update = useCallback(
    (path: string, mutate: (c: GoalCard) => GoalCard) => {
      setCard((prev) => {
        if (!prev) return prev;
        const next = mutate(prev);
        next.updatedAt = new Date().toISOString();
        next.editedFields = prev.editedFields.includes(path)
          ? prev.editedFields
          : [...prev.editedFields, path];
        upsertCard(next);
        // 保存できたので、一時置き場の下書きはもう要らない
        clearPendingCard(next.id);
        return next;
      });
    },
    [],
  );

  // この目標だけの木。中間目標・習慣を編集すると、その場で枝ぶりが変わる
  const tree = useMemo(
    () =>
      buildForest({
        values: big?.values ?? [],
        cards: card ? [card] : [],
        checkpoints: card ? { [card.id]: checkpoints } : {},
        habits: card ? { [card.id]: habits } : {},
        logs,
        today: today(),
      }),
    [big, card, checkpoints, habits, logs],
  );

  if (!ready) {
    return (
      <>
        <AppHeader title="目標" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  if (!card) {
    return (
      <>
        <AppHeader title="目標" />
        <main className="phone flex flex-1 flex-col items-center justify-center gap-4 px-5">
          <p className="text-[14px] text-muted">目標が見つかりませんでした。</p>
          <Link href="/goals" className="text-[13px] underline">
            目標一覧へ戻る
          </Link>
        </main>
      </>
    );
  }

  const coach = COACHES[card.coachId];
  const isDone = (card.status ?? "active") === "done";

  /*
   * 予定は「今日以降でまだ終わっていないもの」を先に数件だけ。
   * 過去の完了分まで全部並べると、それだけで画面が伸びていた。
   */
  const todayStr = today();
  const upcoming = boxes.filter((b) => !b.completedAt && b.date >= todayStr);
  const shownBoxes = showAllBoxes ? boxes : upcoming.slice(0, UPCOMING_LIMIT);
  const hiddenBoxCount = boxes.length - shownBoxes.length;

  /**
   * まだ保存していない下書きなら、ここで初めて永続化する。
   *
   * 「手入力でつくる」は押した時点では保存しない（空の目標が枠を1つ
   * 占めてしまうため）。本人が最初の項目を書けば update() が保存するが、
   * 先に習慣を足した場合はそこを通らないので、その手前で呼ぶ。
   */
  function persistDraft() {
    if (!card || loadCardById(card.id)) return;
    upsertCard(card);
    clearPendingCard(card.id);
  }

  function addObstacle() {
    update("woop.obstacles", (c) => ({
      ...c,
      woop: {
        ...c.woop,
        obstacles: [
          ...c.woop.obstacles,
          {
            id: crypto.randomUUID(),
            text: "",
            situation: "",
            plan: { if: "", then: "" },
          } satisfies Obstacle,
        ],
      },
    }));
  }

  return (
    <>
      <AppHeader title="目標" />
      <main className="phone flex flex-1 flex-col px-5 py-5">
        <div className="flex items-center gap-2.5">
          <CoachAvatar id={card.coachId} size={28} />
          <span className="text-[12px] text-muted">
            {card.source === "manual" ? "手入力" : `${coach?.name ?? ""}との対話`}
          </span>
          {card.sessionId && (
            <Link
              href={`/history/${card.sessionId}`}
              className="text-[12px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              対話を読み返す
            </Link>
          )}
          {isDone && (
            <span className="ml-auto rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">
              完了
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          {/* なりたい姿と期限。このページで一番最初に目に入るべきもの */}
          <Block
            title="なりたい姿"
            accent
            aside={
              card.smart.deadline ? (
                <span className="rounded-full border border-accent-line px-2 py-0.5 font-mono text-[10.5px] text-accent">
                  {card.smart.deadline} ・ {deadlineCountdown(card.smart.deadline, todayStr)}
                </span>
              ) : null
            }
          >
            <EditableField
              label="なりたい姿"
              value={card.vision.refined || card.vision.raw}
              multiline
              onSave={(v) =>
                update("vision.refined", (c) => ({
                  ...c,
                  vision: { ...c.vision, refined: v },
                }))
              }
            />
          </Block>

          {/* ページ内ジャンプ。スクロールせずに目的の段へ行けるように */}
          <nav aria-label="このページの項目" className="flex gap-1.5 overflow-x-auto pb-0.5">
            {[
              ["#sec-plan", "予定"],
              ["#sec-habit", "習慣"],
              ["#sec-checkpoint", "中間目標"],
              ["#sec-obstacle", "つまずき"],
              ["#sec-background", "背景"],
            ].map(([href, text]) => (
              <a
                key={href}
                href={href}
                className="shrink-0 rounded-full border border-line bg-surface px-3 py-1 text-[12px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {text}
              </a>
            ))}
          </nav>

          {/*
            木は幅を抑えて小さく出す（高さは幅に比例する）。
            凡例文は常時出すと場所を取るので、押したときだけ開く。
          */}
          <figure className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className={bigTree ? "" : "mx-auto max-w-[240px]"}>
              <GoalForest
                model={tree}
                single
                label="この目標の木。小枝が中間目標、葉が習慣、地下の根が価値観"
              />
            </div>
            <figcaption className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-[11.5px] text-muted">
              <details className="flex-1">
                <summary className="cursor-pointer">木の見かた</summary>
                <p className="mt-1 leading-relaxed">
                  小枝＝中間目標（芽→花、終わりにしたら落ち葉） ・ 葉＝習慣の続き具合 ・ 根＝中間目標の評価で選んだ価値観
                </p>
              </details>
              <button
                type="button"
                onClick={() => setBigTree((v) => !v)}
                className="self-start underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {bigTree ? "小さく" : "大きく"}
              </button>
            </figcaption>
          </figure>

          {/*
            「次の一歩」（単発タスク）はタイムボックスへ統合した。
            やることだけ決めて時間を決めないと、他のことに時間を奪われる。
            ここでは、この目標に紐づいた予定を出して時間割へ送る。
          */}
          <Block id="sec-plan" title="予定した時間" accent>
            {shownBoxes.length === 0 ? (
              <p className="text-[12.5px] text-muted">
                {boxes.length === 0 ? "予定はまだありません。" : "これからの予定はありません。"}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {shownBoxes.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-lg border border-line bg-paper px-3 py-2"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11.5px] text-muted">
                        {b.date} {b.start}〜{b.end}
                      </span>
                      {b.completedAt && (
                        <span className="ml-auto font-mono text-[10.5px] text-accent">
                          完了
                        </span>
                      )}
                      {/*
                        Google 側で消された予定。時間割では薄く描いて片付けを促すのに、
                        ここでは普通の予定と同じ顔で並んでいた（2026-09-20）
                      */}
                      {!b.completedAt && b.sourceGoneAt && (
                        <span className="ml-auto font-mono text-[10.5px] text-[var(--c-rose-fg)]">
                          Googleで削除済み
                        </span>
                      )}
                    </div>
                    <p
                      className={`mt-0.5 text-[13.5px] leading-relaxed ${
                        b.completedAt ? "text-muted line-through" : ""
                      }`}
                    >
                      {b.title || "（未記入）"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              {/*
                目標を引き継ぐ（`?card=`）。ここから作る予定は、この目標の
                ためのものに決まっているので、向こうで選び直させない
              */}
              <Link
                href={`/plan?card=${encodeURIComponent(card.id)}`}
                className="text-[12px] text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                時間割で予定を作る →
              </Link>
              {(hiddenBoxCount > 0 || showAllBoxes) && (
                <button
                  type="button"
                  onClick={() => setShowAllBoxes((v) => !v)}
                  className="text-[12px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {showAllBoxes
                    ? "これからの予定だけにする"
                    : `過去・完了も含めて全${boxes.length}件を見る`}
                </button>
              )}
            </div>
          </Block>

          {/*
            繰り返すこと。単発の予定と並べて置く。
            別画面に分けると、片方だけ設定して終わってしまう。
          */}
          <Block id="sec-habit" title="繰り返すこと">
            <HabitEditor
              cardId={card.id}
              habits={habits}
              onChange={() => {
                /*
                 * 習慣は目標のidを持つ。目標がまだ下書き（未保存）のまま
                 * 習慣だけ保存されると、どこからも辿れない習慣が残る。
                 * 先に目標を確定させてから習慣を読み直す。
                 */
                persistDraft();
                setHabits(habitsOfCard(card.id));
                setDoomedHabits(allHabitsOfCard(card.id));
              }}
            />
          </Block>

          {/*
            中間目標（週/月）。仮実装。
            大きな物語（年単位）と、日々の時間割の間に段が無かった。
            対話フェーズには組み込まず、ここで手動CRUDだけにしてある
            （2026-09-13 調査: 対話ターンを増やす変更は過去の反省に逆行するため）。
          */}
          <Block id="sec-checkpoint" title="中間目標（週・月）">
            <CheckpointEditor
              cardId={card.id}
              checkpoints={checkpoints}
              bigStoryValues={big?.values ?? []}
              onChange={() => {
                persistDraft();
                setCheckpoints(checkpointsOfCard(card.id));
              }}
            />
          </Block>

          {/* つまずきそうなこと ─ if / then も編集できる */}
          <Block id="sec-obstacle" title="つまずきそうなこと">
            <div className="flex flex-col gap-3">
              {card.woop.obstacles.map((o, i) => (
                <div key={o.id} className="border-t border-line-soft pt-3 first:border-0 first:pt-0">
                  <EditableField
                    label={`つまずきそうなこと${i + 1}`}
                    value={o.text}
                    multiline
                    onSave={(v) =>
                      update(`woop.obstacles[${i}].text`, (c) => ({
                        ...c,
                        woop: {
                          ...c.woop,
                          obstacles: c.woop.obstacles.map((x, j) =>
                            j === i ? { ...x, text: v } : x,
                          ),
                        },
                      }))
                    }
                  />

                  <div className="mt-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-2.5">
                    <div className="flex flex-col gap-1.5">
                      <div>
                        <p className="mb-0.5 text-[11.5px] text-muted">もし（きっかけ）</p>
                        <EditableField
                          label={`つまずき${i + 1}の「もし」`}
                          value={o.plan.if}
                          onSave={(v) =>
                            update(`woop.obstacles[${i}].plan.if`, (c) => ({
                              ...c,
                              woop: {
                                ...c.woop,
                                obstacles: c.woop.obstacles.map((x, j) =>
                                  j === i ? { ...x, plan: { ...x.plan, if: v } } : x,
                                ),
                              },
                            }))
                          }
                        />
                      </div>
                      <div>
                        <p className="mb-0.5 text-[11.5px] text-muted">→ こうする</p>
                        <EditableField
                          label={`つまずき${i + 1}の「こうする」`}
                          value={o.plan.then}
                          onSave={(v) =>
                            update(`woop.obstacles[${i}].plan.then`, (c) => ({
                              ...c,
                              woop: {
                                ...c.woop,
                                obstacles: c.woop.obstacles.map((x, j) =>
                                  j === i
                                    ? { ...x, plan: { ...x.plan, then: v } }
                                    : x,
                                ),
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      update("woop.obstacles", (c) => ({
                        ...c,
                        woop: {
                          ...c.woop,
                          obstacles: c.woop.obstacles.filter((_, j) => j !== i),
                        },
                      }))
                    }
                    aria-label={`つまずきそうなこと${i + 1}を消す`}
                    className="mt-1.5 text-[11.5px] text-muted underline"
                  >
                    この項目を消す
                  </button>
                </div>
              ))}
            </div>
            {/* 空のときは「まだありません」を別行で出さず、追加の1行だけにする */}
            <button
              type="button"
              onClick={addObstacle}
              className={`${card.woop.obstacles.length > 0 ? "mt-2.5" : ""} text-[12px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
            >
              ＋ つまずきそうなことを足す
            </button>
          </Block>

          {/* 何を・どれくらい・いつまでに を1枚に。期限は先頭のバッジにも出ている */}
          <Block title="目標の中身">
            <dl className="flex flex-col gap-2">
              <Row label="何を">
                <EditableField
                  label="何を"
                  value={card.smart.specific}
                  multiline
                  onSave={(v) =>
                    update("smart.specific", (c) => ({
                      ...c,
                      smart: { ...c.smart, specific: v },
                    }))
                  }
                />
              </Row>
              <Row label="どれくらい">
                <EditableField
                  label="どれくらい"
                  value={card.smart.measurable}
                  onSave={(v) =>
                    update("smart.measurable", (c) => ({
                      ...c,
                      smart: { ...c.smart, measurable: v },
                    }))
                  }
                />
              </Row>
              <Row label="いつまでに">
                <EditableField
                  label="いつまでに"
                  type="date"
                  value={card.smart.deadline}
                  onSave={(v) =>
                    update("smart.deadline", (c) => ({
                      ...c,
                      smart: { ...c.smart, deadline: v },
                    }))
                  }
                />
              </Row>
            </dl>
          </Block>

          {/*
            背景（大きな物語とのつながり・これが大事な理由）。
            一度決めたら読み返す頻度が低いので、既定では畳んでおく。
          */}
          <details
            id="sec-background"
            className="group scroll-mt-16 rounded-xl border border-line bg-surface"
          >
            <summary className="cursor-pointer list-none px-3.5 py-3 text-[12.5px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <span className="inline-block transition-transform group-open:rotate-90">▸</span>{" "}
              背景を表示（大きな物語とのつながり・大事な理由）
            </summary>
            <div className="flex flex-col gap-4 border-t border-line px-3.5 py-3">
              <section>
                <SubTitle>大きな物語とのつながり</SubTitle>
                {big ? (
                  <>
                    <label className="flex items-center gap-2.5 text-[13px]">
                      <input
                        type="checkbox"
                        checked={card.bigStoryId === big.id}
                        onChange={(e) =>
                          update("bigStoryId", (c) => ({
                            ...c,
                            bigStoryId: e.target.checked ? big.id : null,
                          }))
                        }
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                      この大きな物語にぶら下げる
                    </label>
                    <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
                      {big.vision.refined || big.vision.raw}
                    </p>
                    <div className="mt-2.5">
                      <p className="mb-1 text-[11.5px] text-muted">なぜ効くか</p>
                      <EditableField
                        label="なぜ効くか"
                        value={card.rationale ?? ""}
                        multiline
                        onSave={(v) => update("rationale", (c) => ({ ...c, rationale: v }))}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] leading-relaxed text-muted">
                    大きな物語がまだありません。
                    <Link href="/story/new" className="ml-1 underline">
                      つくる
                    </Link>
                  </p>
                )}
              </section>

              <section>
                <SubTitle>これが大事な理由</SubTitle>
                {card.meaning.whyChain.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {card.meaning.whyChain.map((why, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                        <div className="flex-1">
                          <EditableField
                            label={`理由${i + 1}`}
                            value={why}
                            multiline
                            onSave={(v) =>
                              update(`meaning.whyChain[${i}]`, (c) => ({
                                ...c,
                                meaning: {
                                  ...c.meaning,
                                  whyChain: c.meaning.whyChain.map((w, j) =>
                                    j === i ? v : w,
                                  ),
                                },
                              }))
                            }
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : big ? (
                  <p className="text-[13px] leading-relaxed text-muted">
                    「なぜ」は大きな物語の側に置いてあります。
                    大事にしているもの: {big.values.join(" / ") || "（未取得）"}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    update("meaning.whyChain", (c) => ({
                      ...c,
                      meaning: { ...c.meaning, whyChain: [...c.meaning.whyChain, ""] },
                    }))
                  }
                  className="mt-2 text-[12px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  ＋ 理由を足す
                </button>
              </section>
            </div>
          </details>

          {/* めったに使わない操作（完了・書き出し・削除）はまとめて畳む */}
          <details className="group rounded-xl border border-line bg-surface">
            <summary className="cursor-pointer list-none px-3.5 py-3 text-[12.5px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <span className="inline-block transition-transform group-open:rotate-90">▸</span>{" "}
              その他の操作（完了にする・保存・削除）
            </summary>
            <div className="flex flex-col gap-2 border-t border-line px-3.5 py-3">
              <button
                type="button"
                onClick={() =>
                  update("status", (c) => ({
                    ...c,
                    status: isDone ? "active" : "done",
                  }))
                }
                className="rounded-xl border border-line bg-paper px-4 py-2.5 text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {isDone ? "進行中に戻す" : "この目標を完了にする（枠が空きます）"}
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    download(
                      `goal-${toLocalDate(new Date(card.createdAt))}.md`,
                      toMarkdown(card, boxes),
                      "text/markdown",
                    )
                  }
                  className="flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-[13px]"
                >
                  Markdown で保存
                </button>
                <button
                  type="button"
                  onClick={() =>
                    download(
                      `goal-${toLocalDate(new Date(card.createdAt))}.json`,
                      JSON.stringify(card, null, 2),
                      "application/json",
                    )
                  }
                  className="flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-[13px]"
                >
                  JSON で保存
                </button>
              </div>

              {confirmDelete ? (
                <div className="rounded-xl border border-line bg-paper px-4 py-3.5">
                  {/*
                    deleteCard() は目標だけでなく、紐づく予定・習慣・習慣の記録も
                    連鎖で消す（storage.ts の deleteCard 参照）。それを言わずに
                    「戻せません」とだけ出すと、消してから初めて巻き添えに気づく
                    ことになる（実際にレビューで指摘された）。件数まで出す。

                    数えるのは doomedHabits（やめた習慣も含む＝実際に消える数）。
                    画面に並ぶ habits（進行中だけ）で数えると、
                    畳んだ習慣とその記録が黙って巻き添えになる。
                  */}
                  <p className="text-[13px] leading-relaxed">
                    この目標を消します。
                    {deleteImpactText({
                      boxes: boxes.length,
                      habits: doomedHabits.length,
                      archivedHabits: doomedHabits.filter((h) => h.archivedAt).length,
                      checkpoints: checkpoints.length,
                    })}
                    戻せません。
                  </p>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        deleteCard(card.id);
                        router.push("/goals");
                      }}
                      className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] text-surface"
                    >
                      消す
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-muted"
                    >
                      やめる
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="self-start px-1 py-1 text-[12.5px] text-muted underline"
                >
                  この目標を消す
                </button>
              )}
            </div>
          </details>
        </div>
      </main>
    </>
  );
}

function Block({
  id,
  title,
  accent,
  aside,
  children,
}: {
  id?: string;
  title: string;
  accent?: boolean;
  /** 見出しの右端に置く小さな表示（期限バッジなど） */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      // 固定ヘッダーの下に見出しが隠れないよう、ジャンプ先に余白を取る
      className={`scroll-mt-16 rounded-xl border bg-surface px-3.5 py-3 ${
        accent ? "border-accent-line" : "border-line"
      }`}
    >
      <div className="flex items-center gap-2">
        <h2
          className={`font-mono text-[10.5px] uppercase tracking-[0.14em] ${
            accent ? "text-accent" : "text-muted"
          }`}
        >
          {title}
        </h2>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
      {children}
    </h3>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
