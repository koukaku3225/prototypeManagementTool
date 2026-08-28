"use client";

import { useCallback, useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { DayGrid } from "@/components/DayGrid";
import { NowBar } from "@/components/NowBar";
import { Snackbar } from "@/components/Snackbar";
import { TimeBoxSheet } from "@/components/TimeBoxSheet";
import {
  deleteTimeBox,
  loadCards,
  timeBoxesOn,
  upsertTimeBox,
} from "@/lib/storage";
import {
  currentBox,
  duplicateSlot,
  durationMin,
  humanDuration,
  nextBox,
  slotAt,
  slotFromNow,
  totalMinutes,
} from "@/lib/timebox";
import { addDays, dueLabel, today } from "@/lib/date";
import { emptyMeta, type TimeBox } from "@/types/timebox";
import type { GoalCard } from "@/types/goal";

/**
 * 時間割。
 *
 * 「何をやるか」は決まっていても、時間を決めていないと他のことに埋まる。
 * 実際に起きていた障害が「ご飯終わり、動画を見た流れで別のことを始めてしまう」
 * という時間帯の奪われ方だったので、先に時間を押さえる場所を作った。
 *
 * 表示はいまのところ1日ぶんだけ。週表示は、1日ぶんが使われるのを見てから。
 */
export default function PlanPage() {
  const [date, setDate] = useState(today());
  const [boxes, setBoxes] = useState<TimeBox[]>([]);
  const [cards, setCards] = useState<GoalCard[]>([]);
  const [editing, setEditing] = useState<TimeBox | null>(null);
  /**
   * 編集中の枠がまだ保存されていないか。
   *
   * 以前は空きを押した瞬間に保存していたので、間違って触っただけで
   * 「（未記入）」の枠が残っていた（実データに2件溜まっていた）。
   * 作るのは保存を押したときだけにする。
   */
  const [isNew, setIsNew] = useState(false);
  const [nowMinutes, setNow] = useState(0);
  const [ready, setReady] = useState(false);
  /** 直前の操作。取り消しに使う */
  const [undo, setUndo] = useState<{ message: string; revert: () => void } | null>(
    null,
  );

  const reload = useCallback((d: string) => setBoxes(timeBoxesOn(d)), []);

  useEffect(() => {
    setCards(loadCards().filter((c) => (c.status ?? "active") !== "done"));
    setReady(true);
  }, []);

  useEffect(() => {
    reload(date);
  }, [date, reload]);

  // 現在時刻。分が変わるたびに動かす（秒まで追う必要はない）
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  const isToday = date === today();

  function close() {
    setEditing(null);
    setIsNew(false);
  }

  function save(b: TimeBox) {
    upsertTimeBox(b);
    reload(date);
    setIsNew(false);
    setEditing((prev) => (prev && prev.id === b.id ? b : prev));
  }

  /**
   * ドラッグで動かした / 長さを変えたとき。
   * 指が滑って15分ずれても戻せるように、取り消しを出す。
   */
  function moveByDrag(box: TimeBox, next: { start: string; end: string }) {
    if (next.start === box.start && next.end === box.end) return;
    const before = box;
    const resized = durationMin(next) !== durationMin(box);
    save({ ...box, ...next });
    setUndo({
      message: `${next.start}〜${next.end} に${resized ? "変えました" : "移しました"}`,
      revert: () => {
        upsertTimeBox(before);
        reload(date);
      },
    });
  }

  /** 新しい枠の下書きを作って開く。保存を押すまで残らない */
  function draftAt(range: { start: string; end: string }) {
    setEditing({
      id: crypto.randomUUID(),
      date,
      start: range.start,
      end: range.end,
      title: "",
      cardId: null,
      color: null,
      meta: emptyMeta(),
      completedAt: null,
      review: null,
      createdAt: new Date().toISOString(),
    });
    setIsNew(true);
  }

  /** 同じ日に複製する。元の直後に置く */
  function duplicate(b: TimeBox) {
    const copy: TimeBox = {
      ...b,
      id: crypto.randomUUID(),
      ...duplicateSlot(b),
      completedAt: null,
      review: null,
      createdAt: new Date().toISOString(),
    };
    upsertTimeBox(copy);
    reload(date);
    setIsNew(false);
    setEditing(copy);
  }

  function remove(id: string) {
    const before = boxes.find((b) => b.id === id);
    deleteTimeBox(id);
    reload(date);
    close();
    // 消したものは戻せないと痛い。取り消しを出す
    if (before) {
      setUndo({
        message: `「${before.title || "（未記入）"}」を消しました`,
        revert: () => {
          upsertTimeBox(before);
          reload(date);
        },
      });
    }
  }

  function complete(b: TimeBox) {
    const done: TimeBox = {
      ...b,
      completedAt: new Date().toISOString(),
      review: b.review ?? { good: "", bad: "", next: "" },
    };
    save(done);
    // 完了した直後は、振り返りを書ける状態で開く
    setEditing(done);
  }

  if (!ready) {
    return (
      <>
        <AppHeader title="時間割" />
        <main className="phone flex-1 px-5 py-10" aria-busy="true" />
      </>
    );
  }

  const planned = totalMinutes(boxes);
  const doneMin = totalMinutes(boxes, true);
  const current = isToday ? currentBox(boxes, nowMinutes) : null;
  const upcoming = isToday ? nextBox(boxes, nowMinutes, 60) : null;

  return (
    <>
      <AppHeader title="時間割" />
      <main className="phone flex min-h-0 flex-1 flex-col px-4 pb-3 pt-3">
        {/* 日付の移動。どれも指で押せる大きさにしてある */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDate(addDays(-1, new Date(`${date}T00:00:00`)))}
            aria-label="前の日"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-[16px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ←
          </button>

          {/*
            遠い日へは←→では届かない。日付そのものを押せるようにして、
            端末のカレンダーで選ばせる（ミニ月カレンダーの代わり）。
            下線つきの文字ではなく、面のあるボタンにした
          */}
          <label className="relative flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border border-line bg-surface px-2">
            <span className="text-[14px] font-medium leading-tight">
              {dueLabel(date)}
            </span>
            <span className="font-mono text-[10.5px] leading-tight text-muted">
              {date} ▾
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="日付を選ぶ"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>

          <button
            type="button"
            onClick={() => setDate(addDays(1, new Date(`${date}T00:00:00`)))}
            aria-label="次の日"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface text-[16px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            →
          </button>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <p className="font-mono text-[11px] text-muted">
            予定 {humanDuration(planned)}
            {doneMin > 0 && ` / 完了 ${humanDuration(doneMin)}`}
            {boxes.length > 0 && ` ・ ${boxes.length}件`}
          </p>
          {!isToday && (
            <button
              type="button"
              onClick={() => setDate(today())}
              className="ml-auto min-h-9 rounded-full border border-accent-line bg-accent-soft px-3 text-[12.5px] text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              今日へ戻る
            </button>
          )}
        </div>

        {/* 時間割は画面の残りぜんぶを使う。下に説明文を置いて狭めない */}
        <div className="relative mt-2 flex min-h-0 flex-1 flex-col">
          <DayGrid
            boxes={boxes}
            nowMinutes={nowMinutes}
            isToday={isToday}
            onPickSlot={(m) => draftAt(slotAt(m))}
            onPickBox={(b) => {
              setIsNew(false);
              setEditing(b);
            }}
            onMoveBox={moveByDrag}
            onCreateRange={draftAt}
          />

          {/*
            予定を足す入口。空きを押すしか作る手段がなく、初見では分からなかった。
            既定の時刻はいま。「いま何をやるか決める」が一番多い使い方なので、
            何も指定しなければ現在時刻がそのままタイムボックスの開始になる
          */}
          <button
            type="button"
            onClick={() =>
              draftAt(isToday ? slotFromNow(nowMinutes) : slotAt(9 * 60))
            }
            aria-label={
              isToday
                ? `予定を追加する（いま ${slotFromNow(nowMinutes).start} から）`
                : "予定を追加する"
            }
            className="absolute bottom-3 right-3 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-indigo text-[26px] leading-none text-surface shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ＋
          </button>
        </div>
      </main>

      {/* いま何の時間かを出し続ける */}
      <NowBar
        current={current}
        next={upcoming}
        nowMinutes={nowMinutes}
        onComplete={complete}
        onEdit={(b) => {
          setIsNew(false);
          setEditing(b);
        }}
      />

      {editing && (
        <TimeBoxSheet
          box={editing}
          cards={cards}
          isNew={isNew}
          onSave={save}
          onDelete={remove}
          onDuplicate={duplicate}
          onClose={close}
        />
      )}

      {undo && (
        <Snackbar
          message={undo.message}
          actionLabel="取り消す"
          onAction={undo.revert}
          onDismiss={() => setUndo(null)}
        />
      )}
    </>
  );
}
