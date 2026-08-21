"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { computeSessionMetrics, type SessionMetrics } from "@/lib/metrics";
import { download } from "@/lib/export";
import { loadArchive, loadCard, loadSession, setVariant } from "@/lib/storage";
import type { ExperimentVariant, GoalCard, Session } from "@/types/goal";
import { PHASE_META } from "@/lib/prompts/phases";

/** 検証用の内部画面。テスト参加者には案内しない。 */
export default function MetricsPage() {
  const [rows, setRows] = useState<SessionMetrics[]>([]);
  const [card, setCard] = useState<GoalCard | null>(null);
  const [raw, setRaw] = useState<Session[]>([]);

  useEffect(() => {
    const live = loadSession();
    const all = [...loadArchive(), ...(live && live.messages.length ? [live] : [])];
    const seen = new Set<string>();
    const unique = all.filter((s) => !seen.has(s.id) && seen.add(s.id));
    setRaw(unique);
    setRows(unique.map(computeSessionMetrics));
    setCard(loadCard());
  }, []);

  const completed = rows.filter((r) => r.completed).length;

  function force(v: ExperimentVariant) {
    setVariant(v);
    location.reload();
  }

  return (
    <main className="phone flex flex-1 flex-col px-5 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="font-mono text-[12px] uppercase tracking-[0.16em] text-muted">
          計測（内部用）
        </h1>
        <Link href="/" className="text-[12px] text-muted underline">
          戻る
        </Link>
      </div>

      <section className="mt-5 rounded-xl border border-line bg-surface px-4 py-4">
        <h2 className="text-[13px] font-bold">M1 完走率</h2>
        <p className="mt-1 font-mono text-[20px] tabular-nums">
          {rows.length ? Math.round((completed / rows.length) * 100) : 0}%
          <span className="ml-2 text-[12px] text-muted">
            {completed} / {rows.length} セッション
          </span>
        </p>
      </section>

      {rows.length === 0 && (
        <p className="mt-4 text-[13px] text-muted">
          まだ対話の記録がありません。
        </p>
      )}

      <div className="mt-3 flex flex-col gap-3">
        {rows.map((r) => (
          <section
            key={r.sessionId}
            className="rounded-xl border border-line bg-surface px-4 py-4"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[11px] text-muted">
                {r.sessionId.slice(0, 8)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  r.completed
                    ? "bg-accent-soft text-accent"
                    : "bg-surface-2 text-muted"
                }`}
              >
                {r.completed ? "完走" : "中断"}
              </span>
            </div>

            <dl className="mt-3 flex flex-col gap-1.5 text-[12.5px]">
              <Row k="バリアント">
                約束 {r.variant.commitmentStep ? "あり" : "なし"} / 待ち時間{" "}
                {r.variant.deliberateDelay ? "あり" : "なし"}
              </Row>
              {!r.completed && r.droppedAtPhase && (
                <Row k="M2 離脱">
                  {PHASE_META[r.droppedAtPhase].label}
                </Row>
              )}
              <Row k="M3 フェーズ2滞在">
                {r.meaningMinutes !== null ? `${r.meaningMinutes} 分` : "—"}
              </Row>
              <Row k="M4 フェーズ2平均字数">
                {r.meaningAvgChars !== null ? `${r.meaningAvgChars} 字` : "—"}
              </Row>
              <Row k="H4 ロック回数">{r.draft.locks} 回</Row>
              {r.draft.locks > 0 && (
                <>
                  <Row k="　打鍵 / 削除">
                    {r.draft.avgCharsTyped} / {r.draft.avgCharsDeleted} 字
                  </Row>
                  <Row k="　初回打鍵まで">
                    {r.draft.avgFirstKeystrokeMs !== null
                      ? `${Math.round(r.draft.avgFirstKeystrokeMs / 100) / 10} 秒`
                      : "打鍵なし"}
                  </Row>
                </>
              )}
              <Row k="ターン数">{r.totalTurns}</Row>
              <Row k="所要時間">
                {r.totalMinutes !== null ? `${r.totalMinutes} 分` : "—"}
              </Row>
            </dl>
          </section>
        ))}
      </div>

      {card && (
        <section className="mt-3 rounded-xl border border-line bg-surface px-4 py-4">
          <h2 className="text-[13px] font-bold">M5 カードの編集箇所</h2>
          {card.editedFields.length === 0 ? (
            <p className="mt-1.5 text-[12.5px] text-muted">編集なし</p>
          ) : (
            <ul className="mt-1.5 flex flex-col gap-1">
              {card.editedFields.map((f) => (
                <li key={f} className="font-mono text-[11.5px]">
                  {f}
                </li>
              ))}
            </ul>
          )}
          <h2 className="mt-4 text-[13px] font-bold">M6 動機の変換</h2>
          <p className="mt-1.5 text-[12.5px]">
            {card.meaning.motivationType}
            {card.meaning.reframedFrom ? " → 変換あり" : " → 変換なし"}
          </p>
          <h2 className="mt-4 text-[13px] font-bold">M7 翌日タスク</h2>
          <p className="mt-1.5 text-[12.5px]">
            {card.tasks[0]?.completedAt
              ? `完了 (${card.tasks[0].completedAt.slice(0, 16).replace("T", " ")})`
              : "未完了"}
          </p>
        </section>
      )}

      <h2 className="mt-7 text-[13px] font-bold">バリアントを固定する</h2>
      <p className="mt-1 text-[12px] text-muted">
        次に始める対話に適用されます。
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[
          { label: "約束○ 待ち○", v: { commitmentStep: true, deliberateDelay: true } },
          { label: "約束○ 待ち×", v: { commitmentStep: true, deliberateDelay: false } },
          { label: "約束× 待ち○", v: { commitmentStep: false, deliberateDelay: true } },
          { label: "約束× 待ち×", v: { commitmentStep: false, deliberateDelay: false } },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => force(o.v)}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-[12px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {o.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() =>
          download(
            `metrics-${new Date().toISOString().slice(0, 10)}.json`,
            JSON.stringify({ metrics: rows, card, sessions: raw }, null, 2),
            "application/json",
          )
        }
        className="mt-5 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        計測データを JSON で書き出す
      </button>
    </main>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted whitespace-pre">{k}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}
