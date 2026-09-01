"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useGridDrag } from "@/hooks/useGridDrag";
import {
  colorOf,
  DAY_MINUTES,
  DEFAULT_DURATION,
  humanDuration,
  layout,
  slotAt,
  toMinutes,
  toTime,
} from "@/lib/timebox";
import type { TimeBox } from "@/types/timebox";

/**
 * 1日の時間割。
 *
 * 操作はGoogleカレンダーに合わせてある。見慣れた動きから外れると、
 * それだけで使いにくいと感じるため。
 *   - 空いているところをタップ → その時刻に30分の枠
 *   - 空いているところを長押しして引く → その範囲の枠（マウスはそのまま引く）
 *   - 枠を長押ししてドラッグ（マウスはそのままドラッグ） → 移動
 *   - 選んだ枠の丸いつまみを引く → 長さを変える（マウスは上下の端でも変えられる）
 *   - 15分刻み、位置は 開始分/1440、重なりは列に詰めて等幅
 *   - 現在時刻に線と時刻
 *
 * 週表示はまだ作らない。まず1日ぶんが使われるかを見る。
 */

/** 1時間の高さ。15分＝14px。指でタップできる下限がこのあたり */
const HOUR_PX = 56;
const GRID_PX = HOUR_PX * 24;
/**
 * マウス用の、枠の中の上下の帯。
 *
 * 触る操作ではここを使わない。30分の枠は高さ28pxしかないので、
 * 上下に帯を置くと移動できる場所が残らなくなる。
 */
const MOUSE_EDGE_PX = 10;

/**
 * 色ごとの見た目。両テーマぶんは globals.css のトークンが面倒みる。
 *
 * BOX_COLORS（timebox.ts）から自動生成しない。Tailwindはビルド時に
 * ソースを静的解析してクラスを拾うので、`border-[var(--c-${color}-line)]`
 * のように文字列を組み立てると、そのクラスは生成されず本番で色が消える。
 * WeekShareBar.tsx が動的な色をインラインstyleで扱っているのも同じ理由。
 * ここは手書きが正しい形で、BOX_COLORS が増えたらここにも1行足す
 * ——足し忘れに気づけるよう、tests/timebox.test.mjs 側でキーの一致を見ている。
 */
export const TONE: Record<string, { box: string; done: string }> = {
  amber: { box: "border-[var(--c-amber-line)] bg-[var(--c-amber-bg)] text-[var(--c-amber-fg)]", done: "border-line bg-surface-2 text-muted" },
  indigo: { box: "border-[var(--c-indigo-line)] bg-[var(--c-indigo-bg)] text-[var(--c-indigo-fg)]", done: "border-line bg-surface-2 text-muted" },
  teal: { box: "border-[var(--c-teal-line)] bg-[var(--c-teal-bg)] text-[var(--c-teal-fg)]", done: "border-line bg-surface-2 text-muted" },
  rose: { box: "border-[var(--c-rose-line)] bg-[var(--c-rose-bg)] text-[var(--c-rose-fg)]", done: "border-line bg-surface-2 text-muted" },
  violet: { box: "border-[var(--c-violet-line)] bg-[var(--c-violet-bg)] text-[var(--c-violet-fg)]", done: "border-line bg-surface-2 text-muted" },
  slate: { box: "border-[var(--c-slate-line)] bg-[var(--c-slate-bg)] text-[var(--c-slate-fg)]", done: "border-line bg-surface-2 text-muted" },
};

export function DayGrid({
  boxes,
  nowMinutes,
  isToday,
  onPickSlot,
  onPickBox,
  onMoveBox,
  onCreateRange,
}: {
  boxes: TimeBox[];
  nowMinutes: number;
  isToday: boolean;
  onPickSlot: (minutes: number) => void;
  onPickBox: (box: TimeBox) => void;
  onMoveBox: (box: TimeBox, next: { start: string; end: string }) => void;
  onCreateRange: (range: { start: string; end: string }) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /**
   * 時間割の高さ。
   *
   * 以前は min(58vh, 520px) で止めていたので、スマホでは画面の下185pxが
   * 説明文のために空いたまま、見える時間帯は8時間しかなかった。
   * body が min-height なので flex だけでは画面いっぱいにならない。
   * 「自分の上端」から「下に居座るもの（いまの時間バー・タブ）」を引いて測る。
   * 下に居座るものの高さは、この高さを変えても動かないので堂々巡りにならない。
   */
  const [fitHeight, setFitHeight] = useState<number | null>(null);
  /** つまみを出す枠。長押しでつかむと選ばれる */
  const [selected, setSelected] = useState<string | null>(null);
  /** 画面の外にある予定を知らせるための、いま見えている範囲（分） */
  const [view, setView] = useState({ from: 0, to: DAY_MINUTES });

  const {
    drag,
    dragging,
    pressingId,
    onBoxPointerDown,
    onEmptyPointerDown,
    consumeClick,
  } = useGridDrag({
    gridHeight: GRID_PX,
    scrollerRef,
    gridRef,
    onCommit: onMoveBox,
    onCreate: onCreateRange,
    onSelect: setSelected,
  });

  useLayoutEffect(() => {
    const fit = () => {
      const el = rootRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const below = Array.from(
        document.querySelectorAll<HTMLElement>("[data-below-grid]"),
      ).reduce((sum, n) => sum + n.offsetHeight, 0);
      const h = Math.max(240, Math.round(window.innerHeight - top - below - 8));
      setFitHeight((prev) => (prev === h ? prev : h));
      // 高さが変われば見えている時間帯も変わる
      measure();
    };
    fit();
    // 描画のたびに測ると、高さを変える → ページの丈が変わる → 測り直す、で
    // 堂々巡りになる。測るのは載ったときと、画面の大きさが変わったときだけ
    const id = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", fit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes.length, isToday]);

  /** 見えている時間帯を測る。画面外の予定を知らせるのに使う */
  const measure = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const from = (el.scrollTop / GRID_PX) * DAY_MINUTES;
    const to = ((el.scrollTop + el.clientHeight) / GRID_PX) * DAY_MINUTES;
    // 同じ値なら state を触らない（毎描画で走るので、堂々巡りにしない）
    setView((prev) => (prev.from === from && prev.to === to ? prev : { from, to }));
  };

  /** その時刻が見えるところまでスクロールする */
  const scrollToMinutes = (minutes: number, offset = 90) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({
      top: Math.max(0, ((minutes - offset) / DAY_MINUTES) * GRID_PX),
      behavior: "smooth",
    });
  };

  /**
   * 開いたとき0時が見えていても意味がない。いまの少し前に合わせる。
   *
   * 高さが決まる前にスクロールさせると、そのときはまだ縦いっぱいに
   * 伸びていてスクロールできる余地がなく、0のままになる。
   * 高さが決まってから、一度だけ動かす。
   */
  const didScroll = useRef(false);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || fitHeight === null || didScroll.current) return;
    didScroll.current = true;
    const target = isToday
      ? nowMinutes - 60
      : (toMinutes(boxes[0]?.start ?? "08:00") ?? 480) - 60;
    el.scrollTop = Math.max(0, (target / DAY_MINUTES) * GRID_PX);
    measure();
    // 初回だけ。以降スクロール位置を奪わない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitHeight]);

  // 日付を変えたら測り直す（予定の位置が変わる）
  useEffect(measure, [boxes]);

  /** ドラッグ中の枠は、プレビューの時刻で描く */
  const preview = (b: TimeBox): TimeBox =>
    drag && drag.kind !== "create" && drag.box.id === b.id
      ? { ...b, start: drag.start, end: drag.end }
      : b;

  const placed = layout(boxes.map(preview));

  /** 画面の外にある予定。上／下それぞれ、いちばん近いもの */
  const above = placed
    .filter((p) => (toMinutes(p.box.end) ?? 0) < view.from)
    .sort((a, b) => (toMinutes(b.box.start) ?? 0) - (toMinutes(a.box.start) ?? 0))[0];
  const below = placed
    .filter((p) => (toMinutes(p.box.start) ?? 0) > view.to)
    .sort((a, b) => (toMinutes(a.box.start) ?? 0) - (toMinutes(b.box.start) ?? 0))[0];

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    // ドラッグ直後の click は捨てる。でないと引いて作った直後に、
    // もう1件できてしまう
    if (dragging || consumeClick()) return;
    if ((e.target as HTMLElement).closest("[data-box]")) return;
    // 何もないところを押したら、選んでいた枠のつまみは引っ込める。
    // ただしタップ自体は「ここに予定を作る」として扱う（1回無駄にしない）
    if (selected) setSelected(null);
    const rect = e.currentTarget.getBoundingClientRect();
    onPickSlot(((e.clientY - rect.top) / GRID_PX) * DAY_MINUTES);
  }

  return (
    <div
      ref={rootRef}
      /*
       * 高さを測れたら flex-1 をやめて、その高さで固定する。
       * flex-1 は flex-basis:0 になるので、高さを指定しても効かない
       */
      className={`relative flex min-h-0 flex-col ${fitHeight ? "shrink-0" : "flex-1"}`}
      style={fitHeight ? { height: fitHeight } : undefined}
    >
      <div
        ref={scrollerRef}
        onScroll={measure}
        className="grid-scroller relative min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-surface"
        // ドラッグ中は指のスクロールを止める。これが無いと画面ごと動く
        style={{ touchAction: dragging ? "none" : "pan-y" }}
      >
        <div
          ref={gridRef}
          className="relative select-none"
          style={{ height: GRID_PX }}
          onClick={handleGridClick}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("[data-box]")) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const min = ((e.clientY - rect.top) / GRID_PX) * DAY_MINUTES;
            const r = slotAt(min, DEFAULT_DURATION);
            onEmptyPointerDown(e, {
              id: "__new__",
              date: "",
              start: r.start,
              end: r.end,
              title: "",
              cardId: null,
              meta: { why: "", obstacle: "", counter: "" },
              completedAt: null,
              review: null,
              createdAt: "",
            });
          }}
          role="grid"
          aria-label="1日の時間割。空いているところを押すと予定を作れます。予定は長押しで動かせます"
        >
          {/* 時刻の目盛り。30分の線を薄く入れると、15分刻みが読みやすい */}
          {Array.from({ length: 24 }, (_, h) => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-line-soft"
              style={{ top: h * HOUR_PX, height: HOUR_PX }}
            >
              <span className="absolute -top-2 left-1.5 bg-surface px-1 font-mono text-[10px] text-muted">
                {String(h).padStart(2, "0")}
              </span>
              <span
                aria-hidden="true"
                className="absolute left-9 right-0 border-t border-dashed border-line-soft"
                style={{ top: HOUR_PX / 2 }}
              />
            </div>
          ))}

          <div className="absolute inset-y-0 left-9 right-1.5">
            {placed.map(({ box, top, height, col, cols }) => {
              const done = Boolean(box.completedAt);
              const tone = TONE[colorOf(box)] ?? TONE.slate;
              const active = drag?.box.id === box.id;
              const picked = selected === box.id;
              const pressing = pressingId === box.id;
              return (
                <div
                  key={box.id}
                  data-box
                  onPointerDown={(e) => onBoxPointerDown(e, box, "move")}
                  onClick={() => {
                    if (dragging || consumeClick()) return;
                    onPickBox(box);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onPickBox(box);
                    }
                  }}
                  style={{
                    position: "absolute",
                    top: `${top * 100}%`,
                    height: `${height * 100}%`,
                    left: `${(col / cols) * 100}%`,
                    width: `calc(${(1 / cols) * 100}% - 3px)`,
                    cursor: active ? "grabbing" : "grab",
                    zIndex: active || picked ? 20 : undefined,
                    // 押した瞬間に沈ませる。長押しを待つあいだ「効いている」と分かる
                    transform: pressing ? "scale(0.97)" : undefined,
                    transition: "transform 120ms",
                  }}
                  className={`overflow-visible rounded-md border text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
                    done ? tone.done : tone.box
                  } ${active || picked ? "shadow-lg ring-2 ring-accent" : ""}`}
                >
                  {/*
                    マウス用の、長さを変える帯。触る操作では使わない
                    （枠の中を全部つかめないと、30分の枠は動かせない）
                  */}
                  <span
                    data-box
                    aria-hidden="true"
                    onPointerDown={(e) => {
                      if (e.pointerType !== "mouse") return;
                      e.stopPropagation();
                      onBoxPointerDown(e, box, "resize-start");
                    }}
                    style={{ height: MOUSE_EDGE_PX, cursor: "ns-resize" }}
                    className="absolute inset-x-0 top-0 z-10 hidden md:block"
                  />

                  <div className="pointer-events-none overflow-hidden px-1.5 py-0.5">
                    <span className="block truncate font-mono text-[9.5px] leading-tight opacity-80">
                      {box.start}
                      {active && <> 〜{box.end}</>}
                    </span>
                    <span
                      className={`block truncate text-[11px] leading-tight ${
                        done ? "line-through" : "font-medium"
                      }`}
                    >
                      {box.title || "（未記入）"}
                    </span>
                  </div>

                  <span
                    data-box
                    aria-hidden="true"
                    onPointerDown={(e) => {
                      if (e.pointerType !== "mouse") return;
                      e.stopPropagation();
                      onBoxPointerDown(e, box, "resize-end");
                    }}
                    style={{ height: MOUSE_EDGE_PX, cursor: "ns-resize" }}
                    className="absolute inset-x-0 bottom-0 z-10 hidden md:block"
                  />

                  {/*
                    選んだときだけ出る、長さを変える丸いつまみ。
                    枠の外にはみ出させるので、28pxの枠でも指で掴める
                  */}
                  {picked && !done && (
                    <>
                      <Handle
                        edge="start"
                        onDown={(e) => onBoxPointerDown(e, box, "resize-start")}
                      />
                      <Handle
                        edge="end"
                        onDown={(e) => onBoxPointerDown(e, box, "resize-end")}
                      />
                    </>
                  )}
                </div>
              );
            })}

            {/* 引いて作っている最中の見え方 */}
            {drag?.kind === "create" && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: `${((toMinutes(drag.start) ?? 0) / DAY_MINUTES) * 100}%`,
                  height: `${(((toMinutes(drag.end) ?? 0) - (toMinutes(drag.start) ?? 0)) / DAY_MINUTES) * 100}%`,
                  left: 0,
                  right: 3,
                }}
                className="rounded-md border-2 border-dashed border-accent bg-accent-soft px-1.5 py-0.5"
              >
                <span className="block font-mono text-[9.5px] leading-tight text-accent">
                  {drag.start}〜{drag.end}
                </span>
              </div>
            )}
          </div>

          {/*
            現在時刻。線だけだと「いま何時か」が読めないので、
            左の目盛りの位置に時刻そのものを出す（Googleカレンダーと同じ）
          */}
          {isToday && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-0 right-0 z-10 flex items-center"
              style={{ top: (nowMinutes / DAY_MINUTES) * GRID_PX }}
            >
              <span className="rounded-full bg-accent px-1 py-px font-mono text-[9.5px] leading-tight text-surface">
                {toTime(nowMinutes)}
              </span>
              <span className="h-px flex-1 bg-accent" />
            </div>
          )}
        </div>
      </div>

      {/*
        画面の外にある予定。
        深夜に開くと0時に合うので、21時の予定が2画面ぶん下にあって
        「2件」と書いてあるのに画面が空、ということが起きていた
      */}
      {above && (
        <OffscreenHint
          side="top"
          label={`${above.box.start} ${above.box.title || "（未記入）"}`}
          onClick={() => scrollToMinutes(toMinutes(above.box.start) ?? 0)}
        />
      )}
      {below && (
        <OffscreenHint
          side="bottom"
          label={`${below.box.start} ${below.box.title || "（未記入）"}`}
          onClick={() => scrollToMinutes(toMinutes(below.box.start) ?? 0)}
        />
      )}

      {/* いまの時刻へ戻る。スクロールで見失ったときに使う */}
      {isToday && (nowMinutes < view.from || nowMinutes > view.to) && (
        <button
          type="button"
          onClick={() => scrollToMinutes(nowMinutes)}
          className="absolute bottom-3 left-3 z-30 min-h-11 rounded-full border border-accent bg-paper px-4 text-[13px] font-medium text-accent shadow-lg"
        >
          いま {toTime(nowMinutes)}
        </button>
      )}

      {/* 動かしている最中の時刻。枠が小さいと中に出しても読めない */}
      {drag && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 bottom-3 z-30 mx-auto w-fit rounded-full border border-accent bg-paper px-3 py-1 font-mono text-[12px] text-accent shadow-lg"
        >
          {drag.start}〜{drag.end}
          <span className="ml-2 opacity-70">
            {humanDuration(
              (toMinutes(drag.end) ?? 0) - (toMinutes(drag.start) ?? 0),
            )}
          </span>
        </div>
      )}
    </div>
  );
}

/** 長さを変える丸いつまみ。枠の外にはみ出して置く */
function Handle({
  edge,
  onDown,
}: {
  edge: "start" | "end";
  onDown: (e: React.PointerEvent) => void;
}) {
  return (
    <span
      data-box
      role="slider"
      aria-label={edge === "start" ? "開始時刻を変える" : "終了時刻を変える"}
      aria-valuetext={edge === "start" ? "開始" : "終了"}
      tabIndex={-1}
      onPointerDown={(e) => {
        e.stopPropagation();
        onDown(e);
      }}
      style={{
        touchAction: "none",
        [edge === "start" ? "top" : "bottom"]: -13,
      }}
      className="absolute left-1/2 z-30 h-[26px] w-[26px] -translate-x-1/2 rounded-full border-2 border-accent bg-paper shadow-md"
    />
  );
}

/** 画面の外にある予定を知らせる帯。押すとそこへ飛ぶ */
function OffscreenHint({
  side,
  label,
  onClick,
}: {
  side: "top" | "bottom";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ [side]: 8 }}
      className="absolute left-1/2 z-20 flex min-h-9 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-paper px-3 text-[12px] text-muted shadow-md"
    >
      <span aria-hidden="true">{side === "top" ? "▲" : "▼"}</span>
      <span className="max-w-[200px] truncate">{label}</span>
    </button>
  );
}
