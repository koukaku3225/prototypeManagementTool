"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CoachAvatar } from "@/components/CoachAvatar";
import { EditableField } from "@/components/EditableField";
import { COACHES } from "@/lib/prompts/coaches";
import { clearBigStory, loadBigStory, loadCards, saveBigStory } from "@/lib/storage";
import type { BigStory, GoalCard } from "@/types/goal";

/** 大きな物語の詳細と編集。節目（1〜3年後）もここで足せる。 */
export default function StoryPage() {
  const router = useRouter();
  const [story, setStory] = useState<BigStory | null>(null);
  const [cards, setCards] = useState<GoalCard[]>([]);
  const [ready, setReady] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setStory(loadBigStory());
    setCards(loadCards());
    setReady(true);
  }, []);

  const update = useCallback((path: string, mutate: (b: BigStory) => BigStory) => {
    setStory((prev) => {
      if (!prev) return prev;
      const next = mutate(prev);
      next.updatedAt = new Date().toISOString();
      next.editedFields = prev.editedFields.includes(path)
        ? prev.editedFields
        : [...prev.editedFields, path];
      saveBigStory(next);
      return next;
    });
  }, []);

  if (!ready) {
    return (
      <>
        <AppHeader title="大きな物語" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  if (!story) {
    return (
      <>
        <AppHeader title="大きな物語" />
        <main className="phone flex flex-1 flex-col items-center justify-center gap-4 px-5">
          <p className="text-[14px] text-muted">まだ大きな物語がありません。</p>
          <Link
            href="/story/new"
            className="rounded-xl bg-indigo px-5 py-3 text-[14px] text-surface"
          >
            つくる
          </Link>
        </main>
      </>
    );
  }

  const coach = COACHES[story.coachId];
  const linked = cards.filter(
    (c) => c.bigStoryId === story.id && (c.status ?? "active") !== "done",
  );

  return (
    <>
      <AppHeader title="大きな物語" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        <div className="flex items-center gap-2.5">
          <CoachAvatar id={story.coachId} size={32} />
          <span className="text-[12px] text-muted">{coach?.name}</span>
          {story.sessionId && (
            <Link
              href={`/history/${story.sessionId}`}
              className="text-[12px] text-muted underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              対話を読み返す
            </Link>
          )}
          <label className="ml-auto flex items-center gap-1.5 font-mono text-[11.5px] text-muted">
            <input
              type="number"
              min={1}
              max={50}
              value={story.horizonYears}
              onChange={(e) =>
                update("horizonYears", (b) => ({
                  ...b,
                  horizonYears: Number(e.target.value) || 1,
                }))
              }
              className="w-14 rounded-md border border-line bg-surface px-2 py-1 text-right"
              aria-label="何年先か"
            />
            年
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <Block title="理想像">
            <EditableField
              label="理想像"
              value={story.vision.refined || story.vision.raw}
              multiline
              onSave={(v) =>
                update("vision.refined", (b) => ({
                  ...b,
                  vision: { ...b.vision, refined: v },
                }))
              }
            />
          </Block>

          <Block title="大事にしているもの">
            <EditableField
              label="大事にしているもの"
              value={story.values.join(" / ")}
              onSave={(v) =>
                update("values", (b) => ({
                  ...b,
                  values: v.split("/").map((s) => s.trim()).filter(Boolean),
                }))
              }
            />
            <p className="mt-1.5 text-[11px] text-muted">スラッシュ区切り</p>
          </Block>

          <Block title="今の立ち位置">
            <EditableField
              label="今の立ち位置"
              value={story.currentPosition}
              multiline
              onSave={(v) => update("currentPosition", (b) => ({ ...b, currentPosition: v }))}
            />
          </Block>

          {/* 節目 ─ 5〜10年と直近の目標の間を埋める中間層 */}
          <Block title="途中の節目">
            <p className="mb-2.5 text-[11.5px] leading-relaxed text-muted">
              1〜3年後にどうなっていたいか。大きな物語と直近の目標の間を埋めます。
            </p>
            {story.milestones.length === 0 && (
              <p className="text-[13px] text-muted">まだありません。</p>
            )}
            <div className="flex flex-col gap-3">
              {story.milestones.map((m, i) => (
                <div key={i} className="rounded-lg border border-line bg-paper px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      value={m.label}
                      placeholder="3年後"
                      onChange={(e) =>
                        update(`milestones[${i}].label`, (b) => ({
                          ...b,
                          milestones: b.milestones.map((x, j) =>
                            j === i ? { ...x, label: e.target.value } : x,
                          ),
                        }))
                      }
                      className="w-24 rounded-md border border-line bg-surface px-2 py-1 font-mono text-[11.5px]"
                      aria-label="いつ"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        update("milestones", (b) => ({
                          ...b,
                          milestones: b.milestones.filter((_, j) => j !== i),
                        }))
                      }
                      className="ml-auto text-[11.5px] text-muted underline"
                    >
                      消す
                    </button>
                  </div>
                  <div className="mt-1.5">
                    <EditableField
                      label="どうなっているか"
                      value={m.state}
                      multiline
                      onSave={(v) =>
                        update(`milestones[${i}].state`, (b) => ({
                          ...b,
                          milestones: b.milestones.map((x, j) =>
                            j === i ? { ...x, state: v } : x,
                          ),
                        }))
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                update("milestones", (b) => ({
                  ...b,
                  milestones: [...b.milestones, { label: "3年後", state: "" }],
                }))
              }
              className="mt-3 text-[12px] text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              ＋ 節目を足す
            </button>
          </Block>

          <Block title={`ぶら下がっている目標  ${linked.length}`}>
            {linked.length === 0 ? (
              <p className="text-[13px] text-muted">まだありません。</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {linked.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/goal/${c.id}`}
                      className="block rounded-lg border border-line bg-paper px-3 py-2.5 text-[13.5px] leading-relaxed"
                    >
                      {c.vision.refined || c.vision.raw || "（未記入の目標）"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/goals?view=tree"
              className="mt-3 inline-block text-[12px] text-muted underline"
            >
              ツリーで見る →
            </Link>
          </Block>
        </div>

        <div className="mt-7 flex flex-col gap-2">
          {confirmDelete ? (
            <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
              <p className="text-[13px] leading-relaxed">
                大きな物語を消します。ぶら下がっている目標は残りますが、
                つながりは切れます。
              </p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    clearBigStory();
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
              大きな物語を消す
            </button>
          )}
        </div>
      </main>
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface px-4 py-4">
      <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
        {title}
      </h2>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}
