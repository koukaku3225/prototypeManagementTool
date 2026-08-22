"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditableField } from "@/components/EditableField";
import {
  archiveSession,
  clearSession,
  loadCard,
  loadSession,
  saveCard,
  saveProfile,
} from "@/lib/storage";
import type { GoalCard, Session } from "@/types/goal";

type Status = "loading" | "ready" | "error";

export default function CardPage() {
  const router = useRouter();
  const [card, setCard] = useState<GoalCard | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Session | null>(null);
  const ran = useRef(false);

  const generate = useCallback(async (session: Session, isRetry: boolean) => {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "small",
          messages: session.messages,
          coachId: session.coachId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? "整理に失敗しました。");

      const now = new Date().toISOString();
      const tomorrow = new Date(Date.now() + 86_400_000)
        .toISOString()
        .slice(0, 10);

      const built: GoalCard = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        coachId: session.coachId,
        vision: data.card.vision,
        meaning: data.card.meaning,
        smart: {
          ...data.card.smart,
          deadline: data.card.smart.deadline ?? "",
        },
        woop: {
          ...data.card.woop,
          obstacles: data.card.woop.obstacles.map(
            (o: GoalCard["woop"]["obstacles"][number]) => ({
              ...o,
              id: crypto.randomUUID(),
            }),
          ),
        },
        tasks: (data.card.tasks ?? []).slice(0, 1).map((t: { title: string; estimateMin: number }) => ({
          id: crypto.randomUUID(),
          title: t.title,
          estimateMin: t.estimateMin,
          dueDate: tomorrow,
          completedAt: null,
        })),
        commitment: {
          accepted: Boolean(data.card.commitment?.userWords),
          acceptedAt: data.card.commitment?.userWords ? now : null,
          userWords: data.card.commitment?.userWords ?? null,
        },
        editedFields: [],
      };

      saveCard(built);
      saveProfile({
        updatedAt: now,
        lifePatterns: data.profile.lifePatterns,
        pastFailures: data.profile.pastFailures,
        valuesAccumulated: data.profile.valuesAccumulated,
        communicationStyle: {
          avgResponseLength: avgUserLength(session),
          prefersConcrete: avgUserLength(session) < 40,
        },
      });
      setCard(built);
      setStatus("ready");
    } catch (err) {
      // 1回だけ自動リトライする
      if (!isRetry) return generate(session, true);
      setError(err instanceof Error ? err.message : "整理に失敗しました。");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const existing = loadCard();
    if (existing) {
      setCard(existing);
      setStatus("ready");
      return;
    }
    const session = loadSession();
    if (!session || session.messages.length === 0) {
      setError("対話が見つかりませんでした。");
      setStatus("error");
      return;
    }
    setTranscript(session);
    void generate(session, false);
  }, [generate]);

  function update(path: string, mutate: (c: GoalCard) => GoalCard) {
    setCard((prev) => {
      if (!prev) return prev;
      const next = mutate(prev);
      next.updatedAt = new Date().toISOString();
      next.editedFields = prev.editedFields.includes(path)
        ? prev.editedFields
        : [...prev.editedFields, path];
      saveCard(next);
      return next;
    });
  }

  if (status === "loading") {
    return (
      <main className="phone flex flex-1 flex-col items-center justify-center gap-3 px-5">
        <div className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 animate-pulse rounded-full bg-accent"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </div>
        <p className="text-[14px] text-muted" aria-live="polite">
          あなたの言葉を整理しています…
        </p>
      </main>
    );
  }

  if (status === "error" || !card) {
    return (
      <main className="phone flex flex-1 flex-col gap-4 px-5 py-10">
        <h1 className="font-serif text-[20px] font-bold">整理できませんでした</h1>
        <p className="text-[14px] text-muted">{error}</p>
        {transcript && (
          <>
            <button
              type="button"
              onClick={() => void generate(transcript, false)}
              className="rounded-xl bg-indigo px-4 py-3 text-[14px] text-surface"
            >
              もう一度試す
            </button>
            <details className="rounded-xl border border-line bg-surface p-4">
              <summary className="cursor-pointer text-[13px] text-muted">
                対話ログを表示する
              </summary>
              <div className="mt-3 flex flex-col gap-2 text-[13px] leading-relaxed">
                {transcript.messages.map((m, i) => (
                  <p key={i} className={m.role === "user" ? "" : "text-muted"}>
                    <span className="font-mono text-[11px]">
                      {m.role === "user" ? "あなた" : "コーチ"}:{" "}
                    </span>
                    {m.content}
                  </p>
                ))}
              </div>
            </details>
          </>
        )}
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-[13px] text-muted underline"
        >
          最初に戻る
        </button>
      </main>
    );
  }

  return (
    <main className="phone flex flex-1 flex-col px-5 py-8">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">
        あなたの目標
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        違うところは直してください。あなたの言葉であることが大事です。
      </p>

      <div className="mt-5 flex flex-col gap-3">
        <Block title="なりたい姿">
          <EditableField
            label="なりたい姿"
            value={card.vision.refined}
            multiline
            onSave={(v) =>
              update("vision.refined", (c) => ({
                ...c,
                vision: { ...c.vision, refined: v },
              }))
            }
          />
        </Block>

        <Block title="これが大事な理由">
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
          {card.meaning.values.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {card.meaning.values.map((v) => (
                <span
                  key={v}
                  className="rounded-full border border-accent-line bg-accent-soft px-2.5 py-0.5 text-[11.5px] text-accent"
                >
                  {v}
                </span>
              ))}
            </div>
          )}
          {card.meaning.reframedFrom && card.meaning.reframed && (
            <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed text-muted">
              「{card.meaning.reframedFrom}」から
              <br />「{card.meaning.reframed}」へ言い換えました
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

        {card.woop.obstacles.map((o, i) => (
          <Block key={o.id} title="つまずきそうなこと">
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
              <p className="mt-1.5 text-[14px] leading-relaxed">
                もし<b>{o.plan.if}</b>
                <br />→ <b>{o.plan.then}</b>
              </p>
            </div>
          </Block>
        ))}

        <Block title="明日やること" accent>
          {card.tasks.map((t, i) => (
            <div key={t.id}>
              <EditableField
                label="明日やること"
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
              <p className="mt-1.5 font-mono text-[11.5px] text-muted">
                {t.estimateMin}分 / {t.dueDate}
              </p>
            </div>
          ))}
          {card.tasks.length === 0 && (
            <p className="text-[13px] text-muted">
              明日やることが取り出せませんでした。自分で書いてください。
            </p>
          )}
        </Block>

        {card.commitment.userWords && (
          <Block title="約束">
            <p className="text-[14px] leading-relaxed">
              「{card.commitment.userWords}」
            </p>
          </Block>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          // 計測データを残してから消す（M1〜M4 の判定に必要）
          const s = loadSession();
          if (s) archiveSession(s);
          clearSession();
          router.push("/home");
        }}
        className="mt-7 rounded-xl bg-indigo px-4 py-3.5 text-[15px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        これで確定する
      </button>
    </main>
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
    <div className="flex flex-col gap-1">
      <dt className="text-[11.5px] text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function avgUserLength(session: Session): number {
  const u = session.messages.filter((m) => m.role === "user");
  if (!u.length) return 0;
  return Math.round(
    u.reduce((sum, m) => sum + m.content.length, 0) / u.length,
  );
}
