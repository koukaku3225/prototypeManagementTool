"use client";

import { useEffect } from "react";
import { useSupabaseUser } from "@/hooks/useSupabaseUser";
import { flushPendingPushes } from "@/lib/supabase/sync";

/**
 * layout.tsx に1つだけ置く。画面には何も出さない。
 * ログイン状態を見て、以後の localStorage 書き込みを裏でSupabaseへ
 * 同期する状態にする（setSyncUser 経由）。ログインしていなければ何もしない。
 */
export function SyncBoot() {
  useSupabaseUser();

  /*
   * クラウドへの押し出しは、打ち終わりを待ってから1回だけ送る
   * （push-queue.ts）。待っている間にタブが閉じられると、その1回が
   * 落ちてクラウドだけが古いまま残る。閉じる・隠す瞬間に送り切る。
   *
   * pagehide を使うのは、iOS Safari で unload が発火しないため。
   * visibilitychange は「タブを裏に回した」「アプリを切り替えた」も拾う。
   * どちらも複数回呼ばれうるが、flush は空なら何もしない。
   */
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushPendingPushes();
    };
    const onPageHide = () => flushPendingPushes();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      // 画面から外れるときも取りこぼさない
      flushPendingPushes();
    };
  }, []);

  return null;
}
