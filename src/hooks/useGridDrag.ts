"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DAY_MINUTES, dragRange, moveBox, resizeBox } from "@/lib/timebox";
import type { TimeBox } from "@/types/timebox";

/**
 * 時間割のドラッグ操作。
 *
 *   移動   … 枠をつかんで動かす（触る操作は長押ししてから）
 *   長さ   … 上端・下端をつかんで引く
 *   新規   … 空いているところを引く
 *
 * ■ つまみを枠の中に置くのをやめた
 * 30分の枠は高さ28pxしかない。そこに上下12pxのつまみを置いていたので、
 * 移動できる帯が中央の2pxしか残っておらず、指ではまず当たらなかった。
 * 「作った予定をドラッグで動かせない」の原因はこれ。
 *
 * いまは触る操作のとき、枠の中はぜんぶ移動に使う。
 * 長さを変えるときは、長押しで枠を選んでから、枠の外に出る丸いつまみを引く
 * （Googleカレンダーのモバイルと同じ形）。
 * マウスは指と違って狙えるので、これまでどおり上下の帯で長さを変えられる。
 *
 * ■ 長押しの時間
 * 380ms は待たされている感じが強く、待ちきれずに動かすと何も起きないので
 * 「反応しない」と感じる。220ms に縮め、押した時点で枠を沈ませて
 * 「受け付けた」ことを先に見せる。
 */

/** 長押しと判定するまでの時間 */
const LONG_PRESS_MS = 220;
/** これ以上動いたら「長押しではなくスクロール」とみなす */
const CANCEL_SLOP_PX = 10;
/** マウスでこれ以上動いたら、ドラッグとみなす */
const CREATE_SLOP_PX = 6;
/** ドラッグ直後の click とみなす時間 */
const TRAILING_CLICK_MS = 400;
/** 端に近づいたら自動でスクロールする距離 */
const EDGE_PX = 44;
const EDGE_SPEED = 8;

export type DragKind = "move" | "resize-start" | "resize-end" | "create";

export interface DragState {
  kind: DragKind;
  /** 動かしている枠。新規のときは仮の枠 */
  box: TimeBox;
  /** いまの時刻（プレビュー用） */
  start: string;
  end: string;
}

interface Origin {
  kind: DragKind;
  box: TimeBox;
  /** つかんだ瞬間の分。移動量の基準 */
  originMinutes: number;
  clientY: number;
}

export function useGridDrag({
  gridHeight,
  scrollerRef,
  gridRef,
  onCommit,
  onCreate,
  onSelect,
}: {
  gridHeight: number;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  gridRef: React.RefObject<HTMLDivElement | null>;
  /** 動かし終わったとき。プレビューではなく確定値 */
  onCommit: (box: TimeBox, next: { start: string; end: string }) => void;
  /** 空きを引いて作り終わったとき */
  onCreate: (range: { start: string; end: string }) => void;
  /** 長押しで枠をつかんだとき。つまみを出すために親へ知らせる */
  onSelect?: (id: string | null) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  /** 押されている枠のid。まだ動いていなくても、受け付けたことを見せる */
  const [pressingId, setPressingId] = useState<string | null>(null);
  /**
   * いまのドラッグ状態の写し。
   *
   * 確定処理を setDrag の更新関数の中に書いてはいけない。
   * React は開発モードで更新関数を2回呼ぶので、副作用がそこにあると
   * 2回走る（引いて作ると予定が2件できる、という形で実際に出た）。
   * 更新関数は「値を返すだけ」にして、確定はここから読む。
   */
  const dragRef = useRef<DragState | null>(null);
  const origin = useRef<Origin | null>(null);
  /** 始まってから実際に動いたか。長押しして離しただけのときに作らせない */
  const moved = useRef(false);
  /**
   * 直前にドラッグを終えた時刻。
   *
   * pointerup のあとに click が続けて飛ぶ。ドラッグ中フラグはその時点で
   * もう false に戻っているので、click 側で弾けず、
   * 「引いて作ったのに2件できる」ことが起きる（実機で確認した不具合）。
   *
   * 「1回ぶん覚えておいて次の click を捨てる」形にしていたが、
   * 触る操作では pointerup のあとに click が飛ばないことがある。
   * そのとき覚えたままになり、次のタップが丸ごと食われて
   * 「一度動かすと、その次にタップしても開かない」状態になっていた。
   * 時間で見れば、飛んでこなくても勝手に切れる。
   */
  const didDragAt = useRef(0);
  const longPress = useRef<number | null>(null);
  const pending = useRef<Origin | null>(null);
  const autoScroll = useRef<number | null>(null);

  /** 画面のY座標を、その日の分に直す */
  const minutesAt = useCallback(
    (clientY: number) => {
      const el = gridRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return ((clientY - rect.top) / gridHeight) * DAY_MINUTES;
    },
    [gridHeight, gridRef],
  );

  const stopAutoScroll = () => {
    if (autoScroll.current !== null) {
      cancelAnimationFrame(autoScroll.current);
      autoScroll.current = null;
    }
  };

  /** 状態と写しを同時に更新する */
  const applyDrag = useCallback((d: DragState | null) => {
    dragRef.current = d;
    setDrag(d);
  }, []);

  const cancelPending = useCallback(() => {
    if (longPress.current !== null) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
    pending.current = null;
    setPressingId(null);
  }, []);

  const finish = useCallback(() => {
    stopAutoScroll();
    cancelPending();
    origin.current = null;
    moved.current = false;
    applyDrag(null);
  }, [applyDrag, cancelPending]);

  /** ドラッグを実際に始める */
  const begin = useCallback(
    (o: Origin) => {
      origin.current = o;
      moved.current = false;
      applyDrag({ kind: o.kind, box: o.box, start: o.box.start, end: o.box.end });
      if (o.kind !== "create") onSelect?.(o.box.id);
      // 触っている場合だけ、短く震わせて「つかんだ」と伝える
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(12);
    },
    [applyDrag, onSelect],
  );

  /** 枠の上で押した */
  const onBoxPointerDown = useCallback(
    (e: React.PointerEvent, box: TimeBox, kind: DragKind) => {
      // 右クリックや副ボタンは無視
      if (e.button !== 0) return;
      const o: Origin = {
        kind,
        box,
        originMinutes: minutesAt(e.clientY),
        clientY: e.clientY,
      };
      // 掴んだ指を最後まで追いかける。要素の外へ出ても離したことにしない。
      // ポインタが既に無効なら例外が飛ぶので、握りつぶす（掴めなくても続けられる）
      try {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* 捕まえられなくても、window 側で追えるので続行する */
      }

      if (e.pointerType === "mouse") {
        // マウスはつかんだ瞬間から。ただし移動は少し動いてから始める
        if (kind === "move") {
          pending.current = o;
        } else {
          e.preventDefault();
          begin(o);
        }
        return;
      }

      // 丸いつまみは「長さを変える」ためだけに出している。
      // 見えている以上、待たせる理由がないので、触った瞬間から始める
      if (kind === "resize-start" || kind === "resize-end") {
        e.preventDefault();
        begin(o);
        return;
      }

      // 枠の移動は長押ししてから。そうしないとグリッドをスクロールできない
      pending.current = o;
      setPressingId(box.id);
      longPress.current = window.setTimeout(() => {
        longPress.current = null;
        if (pending.current) {
          const p = pending.current;
          pending.current = null;
          setPressingId(null);
          begin(p);
        }
      }, LONG_PRESS_MS);
    },
    [begin, minutesAt],
  );

  /**
   * 空いているところで押した。
   *
   * 以前はマウスのときしか受け付けていなかった。そのせいでスマホでは
   * 30分の枠しか作れず、1時間の予定を入れるのに
   * 「タップ → 未記入の枠 → 終了時刻を打ち直す」の3手が必要だった。
   * 移動と同じく、長押ししてから引けばスクロールとは区別できる。
   */
  const onEmptyPointerDown = useCallback(
    (e: React.PointerEvent, template: TimeBox) => {
      if (e.button !== 0) return;
      const o: Origin = {
        kind: "create",
        box: template,
        originMinutes: minutesAt(e.clientY),
        clientY: e.clientY,
      };
      if (e.pointerType === "mouse") {
        pending.current = o;
        return;
      }
      pending.current = o;
      longPress.current = window.setTimeout(() => {
        longPress.current = null;
        if (pending.current) {
          const p = pending.current;
          pending.current = null;
          begin(p);
        }
      }, LONG_PRESS_MS);
    },
    [begin, minutesAt],
  );

  /** 端に寄ったらスクロールを送る */
  const edgeScroll = useCallback(
    (clientY: number) => {
      const el = scrollerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let dir = 0;
      if (clientY < r.top + EDGE_PX) dir = -1;
      else if (clientY > r.bottom - EDGE_PX) dir = 1;
      stopAutoScroll();
      if (dir === 0) return;
      const step = () => {
        el.scrollTop += dir * EDGE_SPEED;
        autoScroll.current = requestAnimationFrame(step);
      };
      autoScroll.current = requestAnimationFrame(step);
    },
    [scrollerRef],
  );

  useEffect(() => {
    function onMove(e: PointerEvent) {
      // まだ始まっていない
      const p = pending.current;
      if (p && !origin.current) {
        const dy = Math.abs(e.clientY - p.clientY);
        if (e.pointerType === "mouse") {
          if (dy > CREATE_SLOP_PX) {
            pending.current = null;
            begin(p);
          }
          return;
        }
        // 触る操作で、長押しの前に動いた＝スクロールしたい
        if (dy > CANCEL_SLOP_PX) cancelPending();
        return;
      }

      const o = origin.current;
      if (!o) return;
      // ドラッグ中はページのスクロールを止める（指の操作を奪う）
      e.preventDefault();
      moved.current = true;
      edgeScroll(e.clientY);

      const nowMin = minutesAt(e.clientY);
      const delta = nowMin - o.originMinutes;

      if (o.kind === "create") {
        applyDrag({ kind: "create", box: o.box, ...dragRange(o.originMinutes, nowMin) });
        return;
      }
      const next =
        o.kind === "move"
          ? moveBox(o.box, delta)
          : resizeBox(o.box, o.kind === "resize-start" ? "start" : "end", delta);
      applyDrag({ kind: o.kind, box: o.box, ...next });
    }

    function onUp() {
      const o = origin.current;
      const d = dragRef.current;
      if (o && d) {
        // 長押ししただけで動かしていないなら、何も作らない・動かさない。
        // 新規のときは、続けて飛んでくる click に30分の枠を作らせる
        if (moved.current) {
          didDragAt.current = Date.now();
          // 確定は状態更新の外で、1回だけ
          if (o.kind === "create") onCreate({ start: d.start, end: d.end });
          else onCommit(o.box, { start: d.start, end: d.end });
        } else if (o.kind !== "create") {
          // つかんだだけ。選んだ状態は残す（続けてつまみを引けるように）
          didDragAt.current = Date.now();
        }
      }
      finish();
    }

    // passive:false にしないと preventDefault が効かない
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      stopAutoScroll();
    };
  }, [begin, cancelPending, edgeScroll, finish, minutesAt, onCommit, onCreate]);

  /**
   * ドラッグ直後の click かどうか。true を返したら、その click は捨てる。
   * 1回ぶんだけ覚えているので、呼ぶたびに消費される。
   */
  const consumeClick = useCallback(() => {
    if (Date.now() - didDragAt.current > TRAILING_CLICK_MS) return false;
    didDragAt.current = 0;
    return true;
  }, []);

  return {
    drag,
    dragging: drag !== null,
    pressingId,
    onBoxPointerDown,
    onEmptyPointerDown,
    consumeClick,
    /** 押したまま離れたときに、始まりかけを取り消す */
    cancelPending,
  };
}
