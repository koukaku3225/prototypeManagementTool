"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CoachAvatar } from "@/components/CoachAvatar";
import { EditableField } from "@/components/EditableField";
import { HabitEditor } from "@/components/HabitEditor";
import { COACHES } from "@/lib/prompts/coaches";
import { download, toMarkdown } from "@/lib/export";
import {
  deleteCard,
  habitsOfCard,
  loadBigStory,
  loadCardById,
  upsertCard,
} from "@/lib/storage";
import { normalizeTime, tomorrow } from "@/lib/date";
import type { BigStory, GoalCard, Obstacle, Task } from "@/types/goal";
import type { Habit } from "@/types/behavior";

/**
 * 目標の詳細と編集。
 * 以前は if-then と明日のタスクだけが編集できず、AIが取り出せなかったときに
 * 「自分で書いてください」と言われても書く手段がなかった。ここでは全項目を
 * 編集でき、障害もタスクも自分で足せる。
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

  useEffect(() => {
    setCard(loadCardById(id));
    setBig(loadBigStory());
    setHabits(habitsOfCard(id));
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
        return next;
      });
    },
    [],
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

  function addTask() {
    update("tasks", (c) => ({
      ...c,
      tasks: [
        ...c.tasks,
        {
          id: crypto.randomUUID(),
          title: "",
          estimateMin: 30,
          // UTC基準だと JST の朝9時までが前日になり、「明日」が今日になる
          dueDate: tomorrow(),
          startTime: null,
          where: null,
          completedAt: null,
        } satisfies Task,
      ],
    }));
  }

  return (
    <>
      <AppHeader title="目標" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        <div className="flex items-center gap-2.5">
          <CoachAvatar id={card.coachId} size={32} />
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

        <div className="mt-4 flex flex-col gap-3">
          <Block title="なりたい姿">
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

          {/* 大きな物語とのつながり */}
          <Block title="大きな物語とのつながり">
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
                <div className="mt-3">
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
          </Block>

          <Block title="目標">
            <dl className="flex flex-col gap-3">
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

          {/* 理由 */}
          <Block title="これが大事な理由">
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
                <br />
                大事にしているもの: {big.values.join(" / ") || "（未取得）"}
              </p>
            ) : (
              <p className="text-[13px] text-muted">まだ記録されていません。</p>
            )}
            <button
              type="button"
              onClick={() =>
                update("meaning.whyChain", (c) => ({
                  ...c,
                  meaning: { ...c.meaning, whyChain: [...c.meaning.whyChain, ""] },
                }))
              }
              className="mt-3 text-[12px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              ＋ 理由を足す
            </button>
          </Block>

          {/* つまずきそうなこと ─ if / then も編集できる */}
          <Block title="つまずきそうなこと">
            {card.woop.obstacles.length === 0 && (
              <p className="text-[13px] text-muted">まだありません。</p>
            )}
            <div className="flex flex-col gap-4">
              {card.woop.obstacles.map((o, i) => (
                <div key={o.id} className="border-t border-line-soft pt-3 first:border-0 first:pt-0">
                  <EditableField
                    label="つまずきそうなこと"
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

                  <div className="mt-3 rounded-lg border border-accent-line bg-accent-soft px-3.5 py-3">
                    <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-accent">
                      もしそうなったら
                    </p>
                    <div className="mt-2 flex flex-col gap-2">
                      <div>
                        <p className="mb-1 text-[11.5px] text-muted">もし（きっかけ）</p>
                        <EditableField
                          label="もし"
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
                        <p className="mb-1 text-[11.5px] text-muted">→ こうする</p>
                        <EditableField
                          label="こうする"
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
                    className="mt-2 text-[11.5px] text-muted underline"
                  >
                    この項目を消す
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addObstacle}
              className="mt-3 text-[12px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              ＋ つまずきそうなことを足す
            </button>
          </Block>

          {/* 次の一歩 ─ 空でも自分で足せる */}
          <Block title="次の一歩" accent>
            {card.tasks.length === 0 && (
              <p className="text-[13px] text-muted">
                まだありません。下から足してください。
              </p>
            )}
            <div className="flex flex-col gap-3">
              {card.tasks.map((t, i) => (
                <div key={t.id}>
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={Boolean(t.completedAt)}
                      onChange={() =>
                        update(`tasks[${i}].completedAt`, (c) => ({
                          ...c,
                          tasks: c.tasks.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  completedAt: x.completedAt
                                    ? null
                                    : new Date().toISOString(),
                                }
                              : x,
                          ),
                        }))
                      }
                      className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1">
                      <EditableField
                        label="やること"
                        value={t.title}
                        multiline
                        onSave={(v) =>
                          update(`tasks[${i}].title`, (c) => ({
                            ...c,
                            tasks: c.tasks.map((x, j) =>
                              j === i ? { ...x, title: v } : x,
                            ),
                          }))
                        }
                      />
                    </span>
                  </label>

                  {/*
                    実行意図の「いつ・どこで」。
                    所要時間や日付と同じ行に並べると埋もれるので、
                    タイトルのすぐ下に、本文に近い強さで置く。
                  */}
                  <div className="mt-2 flex items-center gap-2 pl-7">
                    <input
                      type="time"
                      value={t.startTime ?? ""}
                      onChange={(e) =>
                        update(`tasks[${i}].startTime`, (c) => ({
                          ...c,
                          tasks: c.tasks.map((x, j) =>
                            j === i
                              ? { ...x, startTime: normalizeTime(e.target.value) }
                              : x,
                          ),
                        }))
                      }
                      className="rounded-md border border-line bg-surface px-2 py-1 font-mono text-[12px]"
                      aria-label="開始時刻"
                    />
                    <input
                      type="text"
                      value={t.where ?? ""}
                      placeholder="どこで（例: 自室の机）"
                      onChange={(e) =>
                        update(`tasks[${i}].where`, (c) => ({
                          ...c,
                          tasks: c.tasks.map((x, j) =>
                            j === i ? { ...x, where: e.target.value || null } : x,
                          ),
                        }))
                      }
                      className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
                      aria-label="やる場所"
                    />
                  </div>

                  <div className="mt-1.5 flex items-center gap-3 pl-7">
                    <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
                      <input
                        type="number"
                        min={5}
                        max={480}
                        step={5}
                        value={t.estimateMin}
                        onChange={(e) =>
                          update(`tasks[${i}].estimateMin`, (c) => ({
                            ...c,
                            tasks: c.tasks.map((x, j) =>
                              j === i
                                ? { ...x, estimateMin: Number(e.target.value) || 0 }
                                : x,
                            ),
                          }))
                        }
                        className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-right"
                        aria-label="所要時間（分）"
                      />
                      分
                    </label>
                    <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
                      <input
                        type="date"
                        value={t.dueDate}
                        onChange={(e) =>
                          update(`tasks[${i}].dueDate`, (c) => ({
                            ...c,
                            tasks: c.tasks.map((x, j) =>
                              j === i ? { ...x, dueDate: e.target.value } : x,
                            ),
                          }))
                        }
                        className="rounded-md border border-line bg-surface px-2 py-1"
                        aria-label="日付"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        update("tasks", (c) => ({
                          ...c,
                          tasks: c.tasks.filter((_, j) => j !== i),
                        }))
                      }
                      className="ml-auto text-[11.5px] text-muted underline"
                    >
                      消す
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addTask}
              className="mt-3 text-[12px] text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              ＋ やることを足す
            </button>
          </Block>

          {/*
            繰り返すこと。単発の「次の一歩」と並べて置く。
            別画面に分けると、片方だけ設定して終わってしまう。
          */}
          <Block title="繰り返すこと">
            <HabitEditor
              cardId={card.id}
              habits={habits}
              onChange={() => setHabits(habitsOfCard(card.id))}
            />
          </Block>
        </div>

        {/* 操作 */}
        <div className="mt-7 flex flex-col gap-2">
          <button
            type="button"
            onClick={() =>
              update("status", (c) => ({
                ...c,
                status: isDone ? "active" : "done",
              }))
            }
            className="rounded-xl border border-line bg-surface px-4 py-3 text-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {isDone ? "進行中に戻す" : "この目標を完了にする（枠が空きます）"}
          </button>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                download(
                  `goal-${card.createdAt.slice(0, 10)}.md`,
                  toMarkdown(card),
                  "text/markdown",
                )
              }
              className="flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px]"
            >
              Markdown で保存
            </button>
            <button
              type="button"
              onClick={() =>
                download(
                  `goal-${card.createdAt.slice(0, 10)}.json`,
                  JSON.stringify(card, null, 2),
                  "application/json",
                )
              }
              className="flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px]"
            >
              JSON で保存
            </button>
          </div>

          {confirmDelete ? (
            <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
              <p className="text-[13px] leading-relaxed">
                この目標を消します。戻せません。
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
      </main>
    </>
  );
}

function Block({
  title,
  accent,
  children,
}: {
  title: string;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border bg-surface px-4 py-4 ${
        accent ? "border-accent-line" : "border-line"
      }`}
    >
      <h2
        className={`font-mono text-[10.5px] uppercase tracking-[0.14em] ${
          accent ? "text-accent" : "text-muted"
        }`}
      >
        {title}
      </h2>
      <div className="mt-2.5">{children}</div>
    </section>
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
