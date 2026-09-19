"use client";

import { useEffect, useRef } from "react";
import { createDayWatcher } from "@/lib/day-watch";

/**
 * 画面を開いたまま日付が変わったら、読み直しの合図を出す。
 *
 * 今日・時間割・目標・中間目標は、開いた瞬間に「今日」の分を読み込んで持つ。
 * スマホでは画面を閉じても開いたタブやアプリが残るので、夜に開いたまま寝て
 * 朝に戻ると、前日の予定が「今日」として出たままになる（いまの時間の帯だけは
 * 時計で動くので、前日の予定に今の時刻の線が引かれるという食い違い方をする）。
 *
 * 見るタイミングは、画面が見える状態に戻ったとき・フォーカスが戻ったとき・
 * 履歴から復元されたとき（バックグラウンドのタイマーは止められるので、
 * これが主役）と、開いたまま日付をまたぐ場合に備えた30秒ごと。
 * 日付が同じなら何もしない（読み直さない）。判断は lib/day-watch.ts。
 *
 * onNewDay(新しい今日, 読み込んでいた日) は最新の関数を呼ぶので、
 * 呼び出し側は useCallback で包まなくてよい。
 */
export function useDayRollover(onNewDay: (nowDay: string, prevDay: string) => void) {
  const latest = useRef(onNewDay);
  useEffect(() => {
    latest.current = onNewDay;
  });

  useEffect(() => {
    const watcher = createDayWatcher((next, prev) => latest.current(next, prev));
    const check = () => {
      watcher.check();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    const id = setInterval(check, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      clearInterval(id);
    };
  }, []);
}
