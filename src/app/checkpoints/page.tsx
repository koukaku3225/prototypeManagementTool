"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { useDayRollover } from "@/hooks/useDayRollover";
import {
  checkpointProgress,
  closeAndCarryOver,
  countsForCheckpoint,
  currentCheckpoints,
  defaultPeriod,
  daysLeft,
  formatProgressValue,
  measureOf,
  parseCheckpointTarget,
  pendingReviews,
  periodLabel,
  reviewPickReady,
  withManualCountDelta,
  type CarryOverChoice,
} from "@/lib/checkpoint";
import { goalCardLabel } from "@/lib/goal-card";
import { diffDays, today } from "@/lib/date";
import { deleteCheckpoint, loadCards, loadCheckpoints, loadTimeBoxes, upsertCheckpoint } from "@/lib/storage";
import type {
  Checkpoint,
  CheckpointMeasure,
  CheckpointPeriodKind,
  GoalCard,
} from "@/types/goal";
import type { TimeBox } from "@/types/timebox";

/**
 * 中間目標タブ（2026-09-17）。
 *
 * 目標はあっても、今日やることが「何のためか」につながっていなかった。
 * 目標を今週・今月の測れる目安（時間／回数／達成）に分け、時間割の予定とつなぐ。
 * 設計: docs/superpowers/specs/2026-09-17-checkpoint-tab-design.md
 *
 * 期間が終わったのに閉じていない中間目標は、先頭で振り返ってもらう。
 * 結果を見てから「続ける／目安を変える／終わりにする」を選ぶので、
 * 合わない目安が惰性で続かない。
 */

const MEASURE_LABEL: Record<CheckpointMeasure, string> = { time: "時間", count: "回数", done: "達成" };
const UNIT: Record<CheckpointMeasure, string> = { time: "時間", count: "回", done: "" };

/** 目標ごとの点の色。予定の色（目標から自動）と同じ並びにして、時間割と見た目をそろえる */
const DOTS = ["amber", "rose", "teal", "indigo", "violet", "slate"];

const fmtDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];
const fmtDay = (d: string) => `${fmtDate(d)}（${WEEKDAY[new Date(`${d}T00:00:00`).getDay()]}）`;

export default function CheckpointsPage() {
  const [ready, setReady] = useState(false);
  const [cards, setCards] = useState<GoalCard[]>([]);
  const [list, setList] = useState<Checkpoint[]>([]);
  const [boxes, setBoxes] = useState<TimeBox[]>([]);
  /** 足すシートを開いているか。文字列なら、その目標を選んだ状態で開く */
  const [adding, setAdding] = useState<string | boolean>(false);
  const now = today();

  const reload = useCallback(() => {
    setCards(loadCards());
    setList(loadCheckpoints());
    setBoxes(loadTimeBoxes());
  }, []);

  useEffect(() => {
    reload();
    setReady(true);
  }, [reload]);

  // 開いたまま週や日付が変わったら、終わった期間を「いま」として出し続けない。
  // 再読み込みで再描画されるので、下の `now` も新しい今日になる
  useDayRollover(() => reload());

  // 目標の一覧。完了した目標の中間目標は出さない（今日の画面・リストと同じ扱い）
  const liveCards = useMemo(() => cards.filter((c) => (c.status ?? "active") !== "done"), [cards]);
  const liveIds = useMemo(() => liveCards.map((c) => c.id), [liveCards]);
  const reviews = useMemo(() => pendingReviews(list, liveIds, now), [list, liveIds, now]);
  const current = useMemo(() => currentCheckpoints(list, liveIds, now), [list, liveIds, now]);

  const week = defaultPeriod("week");
  const weekLeft = diffDays(now, week.end) + 1;

  function save(c: Checkpoint) {
    upsertCheckpoint({ ...c, updatedAt: new Date().toISOString() });
    reload();
  }

  if (!ready) {
    return (
      <>
        <AppHeader title="中間目標" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  return (
    <>
      <AppHeader title="中間目標" />
      <main className="phone flex-1 px-4 pb-8 pt-4">
        {reviews.length > 0 && (
          <ReviewSection
            reviews={reviews}
            all={list}
            cards={cards}
            boxes={boxes}
            onDone={(changed) => {
              for (const c of changed) upsertCheckpoint(c);
              reload();
            }}
          />
        )}

        <p className="font-mono text-[10.5px] tracking-[0.14em] text-muted">
          今週 {fmtDay(week.start)} 〜 {fmtDay(week.end)}
        </p>
        <div className="mt-0.5 flex items-baseline gap-2">
          <h1 className="font-serif text-[20px] font-bold">いまの中間目標</h1>
          <span className="ml-auto text-[12px] text-muted">残り{weekLeft}日</span>
        </div>
        {/* 週の経過。過ぎた日は藍、今日は山吹 */}
        <div className="mt-2 grid grid-cols-7 gap-1" aria-label={`今週の${7 - weekLeft + 1}日目`}>
          {Array.from({ length: 7 }, (_, i) => {
            const idx = 7 - weekLeft;
            return (
              <span
                key={i}
                className={`h-[5px] rounded ${i < idx ? "bg-indigo" : i === idx ? "bg-accent" : "bg-line-soft"}`}
              />
            );
          })}
        </div>

        {liveCards.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-line px-4 py-5 text-center text-[13px] leading-relaxed text-muted">
            まだ目標がありません。
            <br />
            <Link href="/goals" className="underline">
              目標をつくる
            </Link>
            と、ここで今週の目安に分けられます。
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {liveCards.map((card, i) => {
              const mine = current.filter((c) => c.cardId === card.id);
              return (
                <section key={card.id} aria-label={goalCardLabel(card)}>
                  <h2 className="mb-1.5 flex items-center gap-2 px-0.5 text-[12px] text-muted">
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: `var(--c-${DOTS[i % DOTS.length]}-line)` }}
                    />
                    <Link href={`/goal/${card.id}`} className="truncate hover:underline">
                      {goalCardLabel(card)}
                    </Link>
                  </h2>
                  {mine.length === 0 ? (
                    /*
                      目標を選び直させない。下の「中間目標を足す」は先頭の目標から始まるので、
                      そのまま足すと別の目標にぶら下がる
                    */
                    <button
                      type="button"
                      onClick={() => setAdding(card.id)}
                      className="min-h-11 w-full rounded-xl border border-dashed border-line px-3 text-left text-[12.5px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    >
                      この期間の中間目標はまだありません ・ <span className="underline">この目標に足す</span>
                    </button>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {mine.map((c) => (
                        <CheckpointRow
                          key={c.id}
                          c={c}
                          color={DOTS[i % DOTS.length]}
                          boxes={boxes}
                          now={now}
                          onSave={save}
                          onDelete={(x) => {
                            deleteCheckpoint(x.id);
                            reload();
                          }}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="min-h-11 rounded-xl border border-dashed border-line text-[13px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              ＋ 中間目標を足す
            </button>
          </div>
        )}
      </main>

      {adding && (
        <AddSheet
          cards={liveCards}
          initialCardId={typeof adding === "string" ? adding : undefined}
          onClose={() => setAdding(false)}
          onAdd={(c) => {
            upsertCheckpoint(c);
            setAdding(false);
            reload();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------- 1件

function CheckpointRow({
  c,
  color,
  boxes,
  now,
  onSave,
  onDelete,
}: {
  c: Checkpoint;
  color: string;
  boxes: TimeBox[];
  now: string;
  onSave: (c: Checkpoint) => void;
  onDelete: (c: Checkpoint) => void;
}) {
  /** 間違えて足したものを片付ける。押し間違いで消えないよう、開いてから選ぶ */
  const [menu, setMenu] = useState<"closed" | "open" | "confirmDelete">("closed");
  const p = checkpointProgress(c, boxes);
  const measure = measureOf(c);
  /*
   * 本人が「完了にする」を押した中間目標。達成（done）はチェック欄で分かるが、
   * 時間・回数は目標の詳細からしか完了にできず、このタブでは何も変わらないのに
   * 今日の画面からは消えていた（`todayCheckpoints` は active だけを出す）。
   * 予定シートも開かない（`presetCheckpointFrom` が active だけを通す）ので、
   * 完了なら完了と見せ、取り消せるようにする。
   */
  const finished = c.status === "done";
  // 次に入っている紐づけた予定。いまより後のうち、いちばん近いもの。
  // Google で消された予定は数にも入らないので、ここでも案内しない
  const next = boxes
    .filter((b) => b.checkpointId === c.id && countsForCheckpoint(b) && !b.completedAt && b.date >= now)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
  const left = daysLeft(c, now);

  return (
    <li className="rounded-xl border border-line bg-surface px-3 py-2.5">
      <div className="flex items-start gap-2">
        {measure === "done" ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={p.met}
            aria-label={p.met ? "できたを取り消す" : "できたにする"}
            onClick={() => onSave({ ...c, status: p.met ? "active" : "done" })}
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-[1.5px] text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
              p.met ? "border-indigo bg-indigo text-surface" : "border-line"
            }`}
          >
            {p.met ? "✓" : ""}
          </button>
        ) : (
          <span className="mt-0.5 shrink-0 rounded-md border border-line bg-paper px-1.5 font-mono text-[10.5px] text-muted">
            {MEASURE_LABEL[measure]}
          </span>
        )}
        <span className={`min-w-0 flex-1 text-[14px] leading-snug ${finished ? "text-muted line-through" : ""}`}>
          {c.title || "（未記入）"}
        </span>
        {measure !== "done" ? (
          <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-[13px] tabular-nums">
            {finished && (
              <span className="rounded-md bg-[var(--c-teal-bg)] px-1.5 text-[10.5px] text-[var(--c-teal-fg)]">
                できた
              </span>
            )}
            {formatProgressValue(measure, p.value)}
            <span className="text-[11px] text-muted">
              {" "}
              / {p.target ?? "—"}
              {UNIT[measure]}
            </span>
          </span>
        ) : (
          <span className="mt-0.5 shrink-0 rounded-md border border-line bg-paper px-1.5 font-mono text-[10.5px] text-muted">
            {c.period.kind === "week" ? "週" : "月"}
          </span>
        )}
        {/* 行の下段は予定の案内とボタンで埋まっているので、上段の右端に置く */}
        <button
          type="button"
          onClick={() => setMenu(menu === "closed" ? "open" : "closed")}
          aria-expanded={menu !== "closed"}
          aria-label={`${c.title || "中間目標"}のほかの操作`}
          className="flex -my-1.5 -mr-1.5 min-h-8 min-w-8 shrink-0 items-center justify-center rounded-lg text-[15px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          ⋯
        </button>
      </div>

      {measure !== "done" && (
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-surface-2" aria-hidden="true">
          <div
            className="h-full rounded"
            style={{ width: `${Math.round(p.ratio * 100)}%`, background: `var(--c-${color}-line)` }}
          />
        </div>
      )}

      <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-muted">
        <span className="min-w-0 flex-1 truncate">
          {measure === "time" && p.doneValue > 0 && `完了 ${formatProgressValue("time", p.doneValue)}時間 ・ `}
          {next
            ? `次：${next.date === now ? "今日" : fmtDate(next.date)} ${next.start} ${next.title || "（未記入）"}`
            : c.period.kind === "month"
              ? `今月 残り${left}日`
              : measure === "done"
                ? ""
                : "この先の予定はまだありません"}
        </span>
        {/* 押し間違いを戻せるように。手で足したぶんがあるときだけ出す */}
        {!finished && measure === "count" && (c.manualCount ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => onSave(withManualCountDelta(c, -1))}
            aria-label={`${c.title}を1回戻す`}
            className="min-h-8 shrink-0 rounded-lg border border-line bg-paper px-2.5 text-[11.5px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            −1
          </button>
        )}
        {!finished && measure === "count" && (
          <button
            type="button"
            onClick={() => onSave(withManualCountDelta(c, 1))}
            aria-label={`${c.title}を1回足す`}
            className="min-h-8 shrink-0 rounded-lg border border-line bg-paper px-2.5 text-[11.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ＋1
          </button>
        )}
        {/* 完了にしたものは予定シートが開かない（presetCheckpointFrom）。押しても何も起きない導線は出さない */}
        {!finished && (
          <Link
            href={`/plan?checkpoint=${c.id}`}
            className="flex min-h-8 shrink-0 items-center rounded-lg border border-accent-line bg-accent-soft px-2.5 text-[11.5px] text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ＋予定に入れる
          </Link>
        )}
      </div>

      {menu !== "closed" && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-soft pt-2 text-[11.5px]">
          {menu === "open" ? (
            <>
              {/* abandoned は既存の「今回は終わりにする」。目標の詳細から「続きから戻す」で戻せる */}
              <button
                type="button"
                onClick={() => onSave({ ...c, status: finished ? "active" : "abandoned" })}
                className="min-h-8 text-muted underline"
              >
                {finished ? "できたを取り消す" : "今回は終わりにする"}
              </button>
              <button
                type="button"
                onClick={() => setMenu("confirmDelete")}
                className="min-h-8 text-muted underline"
              >
                消す
              </button>
              <Link href={`/goal/${c.cardId}#sec-checkpoint`} className="inline-flex min-h-8 items-center text-muted underline">
                目安を直す
              </Link>
            </>
          ) : (
            <>
              <span>
                消しますか？
                {boxes.some((b) => b.checkpointId === c.id) && "（紐づけた予定は残ります）"}
              </span>
              <button type="button" onClick={() => onDelete(c)} className="min-h-8 text-accent underline">
                消す
              </button>
              <button type="button" onClick={() => setMenu("closed")} className="min-h-8 text-muted underline">
                やめる
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- 足す

function AddSheet({
  cards,
  initialCardId,
  onClose,
  onAdd,
}: {
  cards: GoalCard[];
  /** 目標の欄から開いたときの目標 */
  initialCardId?: string;
  onClose: () => void;
  onAdd: (c: Checkpoint) => void;
}) {
  const [cardId, setCardId] = useState(
    initialCardId && cards.some((c) => c.id === initialCardId) ? initialCardId : (cards[0]?.id ?? ""),
  );
  const [title, setTitle] = useState("");
  const [measure, setMeasure] = useState<CheckpointMeasure>("time");
  const [target, setTarget] = useState("5");
  const [kind, setKind] = useState<CheckpointPeriodKind>("week");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const period = defaultPeriod(kind);
  const n = parseCheckpointTarget(measure, target);
  const targetOk = measure === "done" || n !== null;
  const canAdd = Boolean(cardId && title.trim() && targetOk);

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button type="button" aria-label="閉じる" onClick={onClose} className="absolute inset-0 bg-ink/25" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="中間目標を足す"
        className="relative max-h-[92vh] overflow-y-auto rounded-t-2xl border-t border-line bg-paper"
      >
        <div className="phone px-4 pt-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)" }}>
          <div className="flex items-center">
            <span className="font-mono text-[10.5px] tracking-[0.14em] text-muted">中間目標を足す</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="ml-auto flex h-11 w-11 items-center justify-center rounded-full text-[18px] text-muted"
            >
              ✕
            </button>
          </div>

          <label className="block" htmlFor="cp-card">
            <span className="mb-1 block text-[11.5px] text-muted">どの目標のためか</span>
          </label>
          <select
            id="cp-card"
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-[14px]"
          >
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {goalCardLabel(c)}
              </option>
            ))}
          </select>

          <label className="mt-3 block" htmlFor="cp-title">
            <span className="mb-1 block text-[11.5px] text-muted">何をするか</span>
          </label>
          <input
            id="cp-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder={measure === "time" ? "例: 副業に時間を使う" : measure === "count" ? "例: マッチングアプリで2人とやりとりする" : "例: 今週の出会いの予定を立てる"}
            className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-[14px]"
          />

          <p className="mb-1 mt-3 text-[11.5px] text-muted" id="cp-measure-label">
            測り方
          </p>
          <Segmented
            labelledBy="cp-measure-label"
            value={measure}
            options={[
              ["time", "時間"],
              ["count", "回数"],
              ["done", "達成"],
            ]}
            onChange={(v) => setMeasure(v as CheckpointMeasure)}
          />
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            {measure === "time"
              ? "この中間目標に紐づけた予定の時間を、自動で合計します。"
              : measure === "count"
                ? "紐づけた予定を完了にするか、「＋1」を押すと数えます。"
                : "できたらチェックします。"}
          </p>

          {measure !== "done" && (
            <>
              <label className="mb-1 mt-3 block text-[11.5px] text-muted" htmlFor="cp-target">
                目安
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="cp-target"
                  type="number"
                  inputMode="decimal"
                  min={measure === "time" ? 0.5 : 1}
                  step={measure === "time" ? 0.5 : 1}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="min-h-11 w-20 rounded-lg border border-line bg-surface px-3 text-right text-[14px] tabular-nums"
                />
                <span className="text-[13px]">{UNIT[measure]}</span>
              </div>
            </>
          )}

          <p className="mb-1 mt-3 text-[11.5px] text-muted" id="cp-kind-label">
            期間
          </p>
          <Segmented
            labelledBy="cp-kind-label"
            value={kind}
            options={[
              ["week", "今週"],
              ["month", "今月"],
            ]}
            onChange={(v) => setKind(v as CheckpointPeriodKind)}
          />
          <p className="mt-1 text-[11px] text-muted">
            {fmtDay(period.start)} 〜 {fmtDay(period.end)}
          </p>

          <button
            type="button"
            disabled={!canAdd}
            onClick={() => {
              const at = new Date().toISOString();
              onAdd({
                id: crypto.randomUUID(),
                cardId,
                title: title.trim(),
                period: { kind, ...period },
                status: "active",
                measure,
                target: n,
                manualCount: 0,
                previousId: null,
                createdAt: at,
                updatedAt: at,
              });
            }}
            className="mt-4 min-h-[52px] w-full rounded-xl bg-indigo px-4 text-[15px] font-medium text-surface disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            この中間目標を足す
          </button>
        </div>
      </div>
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
  labelledBy,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  labelledBy: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="grid overflow-hidden rounded-lg border border-line bg-surface"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map(([v, label], i) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`min-h-10 text-[13px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
            i > 0 ? "border-l border-line" : ""
          } ${value === v ? "bg-indigo-soft font-medium text-indigo" : ""}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- 振り返り

type Pick3 = "same" | "change" | "end";

function ReviewSection({
  reviews,
  all,
  cards,
  boxes,
  onDone,
}: {
  reviews: Checkpoint[];
  /** 全部の中間目標。今の期間に同じものがあれば二重に作らないために使う */
  all: Checkpoint[];
  cards: GoalCard[];
  boxes: TimeBox[];
  onDone: (changed: Checkpoint[]) => void;
}) {
  const [picks, setPicks] = useState<Record<string, Pick3>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const allPicked = reviews.every((c) => reviewPickReady(c, picks[c.id], targets[c.id]));

  function apply() {
    const changed: Checkpoint[] = [];
    for (const c of reviews) {
      const pick = picks[c.id];
      let choice: CarryOverChoice = { kind: "end" };
      if (pick === "same") choice = { kind: "same" };
      if (pick === "change") {
        // reviewPickReady で弾いているので、ここで null になることは無い
        const n = parseCheckpointTarget(measureOf(c), targets[c.id] ?? "");
        if (n !== null) choice = { kind: "change", target: n };
      }
      const { closed, next } = closeAndCarryOver(c, boxes, choice, new Date(), [...all, ...changed]);
      changed.push(closed);
      if (next) changed.push(next);
    }
    onDone(changed);
  }

  return (
    <section className="mb-6" aria-label="期間が終わった中間目標の振り返り">
      {/*
        期間は1件ずつ出す。週と月が混ざると、先頭と末尾をつないだ範囲（8/1〜9/13 など）は
        どの中間目標の期間でもなくなる
      */}
      <div className="rounded-xl border border-accent-line bg-accent-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-accent">
        <h2 className="font-serif text-[16px] font-bold text-ink">期間が終わった中間目標</h2>
        結果を見て、続けるか、変えるか、終わりにするかを選ぶと、今の期間の中間目標ができます。
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {reviews.map((c) => {
          const p = checkpointProgress(c, boxes);
          const measure = measureOf(c);
          const card = cards.find((x) => x.id === c.cardId);
          const pick = picks[c.id];
          return (
            <li key={c.id} className="rounded-xl border border-line bg-surface px-3 py-2.5">
              <p className="flex gap-2 text-[11.5px] text-muted">
                {card && <span className="min-w-0 truncate">{goalCardLabel(card)}</span>}
                <span className="ml-auto shrink-0 font-mono">{periodLabel(c.period)}</span>
              </p>
              <p className="text-[14px] leading-snug">{c.title || "（未記入）"}</p>
              <div className="mt-1 flex items-baseline gap-1.5">
                {measure !== "done" && (
                  <>
                    <span className="text-[18px] font-medium tabular-nums">{formatProgressValue(measure, p.value)}</span>
                    <span className="text-[11.5px] text-muted">
                      / {p.target ?? "—"}
                      {UNIT[measure]}
                    </span>
                  </>
                )}
                <span
                  className={`ml-auto rounded-md px-1.5 text-[10.5px] ${
                    p.met
                      ? "bg-[var(--c-teal-bg)] text-[var(--c-teal-fg)]"
                      : "bg-[var(--c-amber-bg)] text-[var(--c-amber-fg)]"
                  }`}
                >
                  {p.met ? "できた" : measure === "done" ? "まだ" : `${Math.round(p.ratio * 100)}%`}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`${c.title}をどうするか`}>
                {(
                  [
                    ["same", measure === "done" ? "もう一度\nやる" : "同じ目安で\n続ける"],
                    ["change", "目安を変えて\n続ける"],
                    ["end", "終わりに\nする"],
                  ] as [Pick3, string][]
                )
                  .filter(([v]) => !(measure === "done" && v === "change"))
                  .map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={pick === v}
                      onClick={() => {
                        setPicks((s) => ({ ...s, [c.id]: v }));
                        if (v === "change" && !targets[c.id]) {
                          setTargets((s) => ({ ...s, [c.id]: String(c.target ?? "") }));
                        }
                      }}
                      className={`min-h-11 whitespace-pre-line rounded-lg border px-1 text-[11px] leading-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                        pick === v ? "border-indigo bg-indigo-soft font-medium text-indigo" : "border-line text-muted"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
              </div>
              {pick === "change" && (
                <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
                  次の目安
                  <input
                    id={`cp-next-${c.id}`}
                    type="number"
                    inputMode="decimal"
                    min={measure === "time" ? 0.5 : 1}
                    step={measure === "time" ? 0.5 : 1}
                    value={targets[c.id] ?? ""}
                    onChange={(e) => setTargets((s) => ({ ...s, [c.id]: e.target.value }))}
                    className="min-h-9 w-16 rounded-md border border-line bg-paper px-2 text-right text-[13px] tabular-nums text-ink"
                  />
                  {UNIT[measure]}
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={!allPicked}
        onClick={apply}
        className="mt-2 min-h-[48px] w-full rounded-xl bg-indigo px-4 text-[14.5px] font-medium text-surface disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {allPicked
          ? "この内容で始める"
          : reviews.some((c) => picks[c.id] === "change" && !reviewPickReady(c, "change", targets[c.id]))
            ? "次の目安を数で入れてください"
            : `あと${reviews.filter((c) => !picks[c.id]).length}件選んでください`}
      </button>
    </section>
  );
}
