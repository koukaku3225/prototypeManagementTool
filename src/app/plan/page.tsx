"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { CalendarSyncBoot } from "@/components/CalendarSyncBoot";
import { DayGrid } from "@/components/DayGrid";
import { NowBar } from "@/components/NowBar";
import { Snackbar } from "@/components/Snackbar";
import { TimeBoxSheet } from "@/components/TimeBoxSheet";
import {
  activeHabits,
  clearHabitLogFromBox,
  deleteTimeBox,
  loadBigStory,
  readDeviceFlag,
  writeDeviceFlag,
  loadCards,
  loadTimeBoxes,
  setHabitLog,
  timeBoxesOn,
  upsertTimeBox,
} from "@/lib/storage";
import { habitBoxesOn, habitsOfActiveCards, isGhost, materializeHabitBox } from "@/lib/habit-plan";
import {
  currentBox,
  durationMin,
  humanDuration,
  nextBox,
  slotAt,
  slotFromNow,
  totalMinutes,
} from "@/lib/timebox";
import { addDays, dueLabel, today } from "@/lib/date";
import { DEVICE_KEY } from "@/lib/storage-keys";
import { shouldShowOnboarding } from "@/lib/onboarding";
import { presetCardIdFrom } from "@/lib/goal-card";
import type { OverlayEvent } from "@/lib/calendar/overlay";
import { MAX_SMALL_STORIES } from "@/types/goal";
import { emptyMeta, emptyReview, type TimeBox } from "@/types/timebox";
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
  /**
   * 目標画面から `?card=` で渡ってきた目標。
   * この画面で作る新しい予定に、最初から紐づけておく（選び直させない）。
   */
  const [presetCardId, setPresetCardId] = useState<string | null>(null);
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
  /**
   * 初回の案内を出すか。
   *
   * 既定の表示を時間割にしたことで、何も持っていない人が最初に見るのが
   * 空のグリッドと＋ボタンだけになった。対話への入口は目標タブの
   * 空状態にしか無く、自分でタブを押さない限り届かない。
   */
  const [showIntro, setShowIntro] = useState(false);
  /**
   * Googleカレンダーの本物の予定。時間割に重ねて出すためだけに持つ。
   *
   * アプリのデータにはしない（localStorage にも Supabase にも書かない）。
   * 取り込むと専用カレンダーへ書き戻されて予定が二重になり、
   * 次の同期で消える。混ぜないことが前提の設計。
   */
  const [overlay, setOverlay] = useState<OverlayEvent[]>([]);
  /**
   * 重ね表示が「権限不足」で読めていないか。
   *
   * 連携し直さないと直らない状態なので、黙って0件にしない。
   * 出しっぱなしにならないよう、読めた時点で必ず下ろす。
   */
  const [needsReconnect, setNeedsReconnect] = useState(false);
  /** 直前の操作。取り消しに使う */
  const [undo, setUndo] = useState<{ message: string; revert: () => void } | null>(
    null,
  );

  /**
   * その日の枠。実体のある枠に、習慣から起こした枠を混ぜる。
   *
   * 起こした枠は保存しない（habit-plan.ts の方針）。触られて初めて実体になる。
   * ここで混ぜておけば、時間割の描画もドラッグも実体と同じ扱いで済む。
   */
  const reload = useCallback((d: string) => {
    const real = timeBoxesOn(d);
    // cards state に頼らず毎回読み直す。reload は cards のセット前にも呼ばれる
    const habits = habitsOfActiveCards(activeHabits(), loadCards());
    setBoxes([...real, ...habitBoxesOn(d, habits, loadTimeBoxes())]);
  }, []);

  useEffect(() => {
    const all = loadCards();
    // 絞り込まずに全件持つ。完了した目標を選択肢に出すかは TimeBoxSheet 側の判断
    setCards(all);
    /*
     * useSearchParams ではなく location を読む。この画面はクライアント側
     * だけで完結していて、Suspense 境界を足す理由がここには無い
     * （CalendarLink も同じやり方で `?calendar=` を読んでいる）。
     */
    setPresetCardId(presetCardIdFrom(location.search, all));
    setShowIntro(
      shouldShowOnboarding({
        hasBigStory: loadBigStory() !== null,
        cardCount: all.length,
        // 習慣から起こしただけの枠は数えない。実体だけを見る
        timeBoxCount: loadTimeBoxes().length,
        habitCount: activeHabits().length,
        dismissed: readDeviceFlag(DEVICE_KEY.introDismissed) === "1",
      }),
    );
    setReady(true);
  }, []);

  useEffect(() => {
    reload(date);
  }, [date, reload]);

  /*
   * 表示している日の「本物の予定」を取り直す。
   *
   * 失敗しても時間割は普通に使えなければならないので、
   * 何も言わずに空にする（付加機能が主機能を止めない）。
   * 日付を切り替えている最中の応答が入れ替わらないよう、
   * 古い応答は捨てる。
   */
  useEffect(() => {
    let alive = true;
    setOverlay([]);
    fetch(`/api/calendar/overlay?date=${date}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        if (d?.ok) {
          setOverlay(d.events ?? []);
          // 読めたということは権限は足りている。古い印は消す
          setNeedsReconnect(false);
          writeDeviceFlag(DEVICE_KEY.calendarNeedsReconnect, "0");
          return;
        }
        /*
         * 「連携し直せば直る」失敗だけは黙って捨てない。
         *
         * 読み取りの権限を後から足しても、既に連携済みの人の
         * refresh_token には遡って付かない。本人が同意し直すまで
         * 重ね表示は永久に0件のままで、しかも理由がどこにも出ない
         * （2026-09-08 指摘2）。設定画面でも出せるよう印を残す。
         */
        if (d?.reason === "reconnect_required") {
          setNeedsReconnect(true);
          writeDeviceFlag(DEVICE_KEY.calendarNeedsReconnect, "1");
        }
      })
      .catch(() => {
        /* 連携していない・通信できない。重ねないだけ */
      });
    return () => {
      alive = false;
    };
  }, [date]);

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

  /**
   * 保存する。習慣から起こしただけの枠なら、ここで初めて実体にする。
   *
   * 触られるまで書かないので、画面を開いただけでは行が増えない。
   * 実体になった時点で、以後その枠は習慣の定義から独立して動かせる
   * （時刻をずらしたのに翌週それが消える、という挙動を避ける）。
   */
  function save(b: TimeBox) {
    const before = boxes.find((x) => x.id === b.id);
    const real = isGhost(b) ? materializeHabitBox(b, crypto.randomUUID()) : b;
    upsertTimeBox(real);
    /*
     * 未完了から完了に変わった瞬間だけ、習慣の記録にも印を付ける。
     * 完了は「シートの完了ボタン」「行のチェック」「いまの時間バー」の
     * どこからでも押せて、どれも最後はここを通る。片方にだけ書くと
     * 押した場所によって達成率が変わってしまう（実際そうなっていた）。
     */
    if (real.habitId && real.completedAt && !before?.completedAt) {
      setHabitLog({
        habitId: real.habitId,
        date: real.date,
        state: "done",
        at: real.completedAt,
        note: null,
        mood: null,
      });
    }
    // 逆に、完了を取り消したら、この枠が付けた記録も取り消す（setHabitLog と対称）
    if (real.habitId && !real.completedAt && before?.completedAt) {
      clearHabitLogFromBox(real.habitId, real.date, before.completedAt);
    }
    reload(date);
    setIsNew(false);
    setEditing((prev) => (prev && prev.id === b.id ? real : prev));
    return real;
  }

  /**
   * ドラッグで動かした / 長さを変えたとき。
   * 指が滑って15分ずれても戻せるように、取り消しを出す。
   */
  function moveByDrag(box: TimeBox, next: { start: string; end: string }) {
    if (next.start === box.start && next.end === box.end) return;
    const before = box;
    const resized = durationMin(next) !== durationMin(box);
    const real = save({ ...box, ...next });
    setUndo({
      message: `${next.start}〜${next.end} に${resized ? "変えました" : "移しました"}`,
      revert: () => {
        /*
         * 習慣から起こしただけの枠（ghost）を戻すときは、ghostのidのまま
         * upsertTimeBox すると「habit- で始まる実体」が新規に増える。
         * isGhost() は id のプレフィックスで判定するため、それは以後
         * 永遠にghost扱いのまま消せなくなる（削除ボタンが出ない・
         * カレンダー同期からも除外される）。ghostだったなら、動かして
         * できた実体を削除するだけで元のghost表示に戻る
         */
        if (isGhost(before)) {
          deleteTimeBox(real.id);
        } else {
          upsertTimeBox(before);
        }
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
      // 目標画面から来たなら、その目標を最初から入れておく
      cardId: presetCardId,
      color: null,
      meta: emptyMeta(),
      completedAt: null,
      review: null,
      createdAt: new Date().toISOString(),
    });
    setIsNew(true);
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
    const at = new Date().toISOString();
    const done: TimeBox = {
      ...b,
      completedAt: at,
      review: b.review ?? emptyReview(),
    };
    // 習慣の記録は save() が面倒を見る（完了はどこからでも押せるため）
    const real = save(done);
    // 完了した直後は、振り返りを書ける状態で開く
    setEditing(real);
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
      <CalendarSyncBoot onApplied={() => reload(date)} />
      <main className="phone flex min-h-0 flex-1 flex-col px-4 pb-3 pt-3">
        {/*
          重ね表示が権限不足で読めていないときだけ出す。
          黙って0件にすると「実装したのに動かない、理由も出ない」になる。
          押す先は設定画面。ここから直接 /api/calendar/connect へ送らないのは、
          連携し直すと何が起きるかを読んでから決めてほしいため。
        */}
        {needsReconnect && (
          <p
            role="status"
            className="mb-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-3 text-[12.5px] leading-relaxed text-accent"
          >
            Googleカレンダーを読む許可が足りないので、ほかの予定を重ねて表示できていません。
            <Link href="/settings" className="ml-1 underline">
              設定から連携し直す
            </Link>
          </p>
        )}
        {/*
          初めて使う人への案内。
          何も持っていない人が空のグリッドに置き去りになるのを防ぐ。
          所要時間を先に書くのは、離脱の最大要因が「思ったより長い」だから
          （mvp-spec §3.2）。「先に時間割だけ使う」で閉じられる＝判断を奪わない。
        */}
        {showIntro && (
          <section className="mb-3 rounded-xl border border-accent-line bg-accent-soft px-4 py-4">
            <h2 className="font-serif text-[19px] leading-[1.45] font-bold text-balance text-accent">
              あなたの&ldquo;理想&rdquo;を、明日の一歩に変えます
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-accent">
              まず5〜10年の大きな物語を言葉にして、そこから直近の目標を
              最大{MAX_SMALL_STORIES}つまでぶら下げていきます。
              <br />
              対話は約30〜40分。途中で中断できます。
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <Link
                href="/story/new"
                className="rounded-xl bg-indigo px-4 py-3 text-center text-[14.5px] font-medium text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                大きな物語をつくる
              </Link>
              <Link
                href="/goal/new"
                className="rounded-xl border border-line bg-surface px-4 py-2.5 text-center text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                先に直近の目標だけつくる
              </Link>
              <button
                type="button"
                onClick={() => {
                  writeDeviceFlag(DEVICE_KEY.introDismissed, "1");
                  setShowIntro(false);
                }}
                className="min-h-9 text-[12.5px] text-accent underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                先に時間割だけ使う
              </button>
            </div>
          </section>
        )}

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
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {!isToday && (
              <button
                type="button"
                onClick={() => setDate(today())}
                className="min-h-9 rounded-full border border-accent-line bg-accent-soft px-3 text-[12.5px] text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                今日へ戻る
              </button>
            )}
            {/*
              表示の切り替え。既定はこの時間割で、一覧で見たいときだけ移る。
              日付は持ち回さない。リスト側は「今日」だけを出す画面で、
              渡しても無視されるので、URLに書くと嘘になる
            */}
            <Link
              href="/list"
              className="flex min-h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12.5px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />
              </svg>
              リスト
            </Link>
          </div>
        </div>

        {/* 時間割は画面の残りぜんぶを使う。下に説明文を置いて狭めない */}
        <div className="relative mt-2 flex min-h-0 flex-1 flex-col">
          <DayGrid
            boxes={boxes}
            overlay={overlay}
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
