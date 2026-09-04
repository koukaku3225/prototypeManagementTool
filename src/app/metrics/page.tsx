"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { computeSessionMetrics, type SessionMetrics } from "@/lib/metrics";
import { download } from "@/lib/export";
import { today } from "@/lib/date";
import { USD_JPY, yenOf } from "@/lib/pricing";
import {
  loadArchive,
  loadCard,
  loadSession,
  setVariant,
  timeBoxesOfCard,
} from "@/lib/storage";
import type { ExperimentVariant, GoalCard, Session } from "@/types/goal";
import type { TimeBox } from "@/types/timebox";
import { PHASE_META } from "@/lib/prompts/phases";

/** 検証用の内部画面。テスト参加者には案内しない。 */
export default function MetricsPage() {
  const [rows, setRows] = useState<SessionMetrics[]>([]);
  const [card, setCard] = useState<GoalCard | null>(null);
  const [boxes, setBoxes] = useState<TimeBox[]>([]);
  const [raw, setRaw] = useState<Session[]>([]);

  useEffect(() => {
    const live = loadSession();
    const all = [...loadArchive(), ...(live && live.messages.length ? [live] : [])];
    const seen = new Set<string>();
    const unique = all.filter((s) => !seen.has(s.id) && seen.add(s.id));
    setRaw(unique);
    setRows(unique.map(computeSessionMetrics));
    const c = loadCard();
    setCard(c);
    setBoxes(c ? timeBoxesOfCard(c.id) : []);
  }, []);

  const completed = rows.filter((r) => r.completed).length;

  // M8: 計測できたセッションだけで平均を出す。旧セッションは usage を持たない
  const priced = rows.filter((r) => r.cost.calls > 0);
  const totalYen = priced.reduce((n, r) => n + r.cost.yen, 0);
  const totalHitRate = ratio(
    priced.reduce((n, r) => n + r.cost.cacheRead, 0),
    priced.reduce(
      (n, r) => n + r.cost.input + r.cost.cacheRead + r.cost.cacheWrite,
      0,
    ),
  );
  const savedYen =
    yenOf(priced.reduce((n, r) => n + r.cost.usdWithoutCache, 0)) - totalYen;

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
        <Link href="/me" className="text-[12px] text-muted underline">
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

      <section className="mt-3 rounded-xl border border-line bg-surface px-4 py-4">
        <h2 className="text-[13px] font-bold">M8 トークンとコスト</h2>
        {priced.length === 0 ? (
          <p className="mt-1.5 text-[12.5px] text-muted">
            まだ計測できたセッションがありません。
          </p>
        ) : (
          <>
            <p className="mt-1 font-mono text-[20px] tabular-nums">
              {yen(totalYen / priced.length)}
              <span className="ml-2 text-[12px] text-muted">
                / セッション（{priced.length} 本の平均）
              </span>
            </p>
            <dl className="mt-3 flex flex-col gap-1.5 text-[12.5px]">
              <Row k="合計">{yen(totalYen)}</Row>
              <Row k="キャッシュ命中率">{pct(totalHitRate)}</Row>
              <Row k="キャッシュで浮いた額">{yen(savedYen)}</Row>
            </dl>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              命中率は入力トークンのうちキャッシュから読めた割合。
              単価は lib/pricing.ts に手で書いた値（1ドル {USD_JPY} 円）。
            </p>
          </>
        )}
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
              {r.cost.calls > 0 && (
                <>
                  <Row k="M8 コスト">
                    {yen(r.cost.yen)}
                    <span className="ml-1 text-muted">
                      / {r.cost.calls} 回
                    </span>
                  </Row>
                  <Row k="　入力（定価 / 読 / 書）">
                    {r.cost.input} / {r.cost.cacheRead} / {r.cost.cacheWrite}
                  </Row>
                  <Row k="　出力">{r.cost.output}</Row>
                  <Row k="　キャッシュ命中率">{pct(r.cost.cacheHitRate)}</Row>
                </>
              )}
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
          <h2 className="mt-4 text-[13px] font-bold">M7 翌日の予定</h2>
          <p className="mt-1.5 text-[12.5px]">
            {boxes.length === 0
              ? "予定なし"
              : `${boxes.filter((b) => b.completedAt).length}/${boxes.length} 完了`}
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
            `metrics-${today()}.json`,
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

/** 1円未満が普通に出るので、小さいときは小数を残す */
function yen(v: number): string {
  if (v === 0) return "0 円";
  if (Math.abs(v) < 1) return `${v.toFixed(2)} 円`;
  if (Math.abs(v) < 100) return `${v.toFixed(1)} 円`;
  return `${Math.round(v)} 円`;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

const ratio = (a: number, b: number): number => (b ? a / b : 0);

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted whitespace-pre">{k}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}
