"use client";

import { useEffect } from "react";

/**
 * スマホアプリとして入れるための下準備。どの画面にいても1回だけ動く。
 *
 * ■ インストールのダイアログは、最初に取り置いておく
 * Android の Chrome は、条件が揃うと `beforeinstallprompt` を1回だけ投げてくる。
 * これを受け取った画面にいなければ、あとから「インストール」ボタンを押しても
 * 呼び出す手段が無い。そこで全画面共通のここで受け取り、取り置く。
 * ボタン（InstallCard）は取り置いたものを使う。
 *
 * ■ サービスワーカーは本番だけ
 * 開発中（npm run dev）に入れると、古い画面やファイルを握って
 * 「直したのに変わらない」が起きる。本番（next build）でだけ登録する。
 */

/** Chrome 系だけが持つイベント。標準の型に無いので自前で書く */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** 取り置いたダイアログ。無ければ null（呼べないブラウザ・入れ終わった後） */
export const getInstallPrompt = () => deferred;

export function onInstallPromptChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 1回呼んだら使えなくなる（ブラウザの仕様）。呼んだ側が捨てる */
export function clearInstallPrompt() {
  deferred = null;
  notify();
}

export function PwaBoot() {
  useEffect(() => {
    const onPrompt = (e: Event) => {
      // ブラウザが勝手に出す帯を止めて、こちらのボタンから出す
      e.preventDefault();
      deferred = e as BeforeInstallPromptEvent;
      notify();
    };
    const onInstalled = () => clearInstallPrompt();
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch((err) => {
          // 登録できなくても、ふつうのWebとしては使える
          console.warn("[pwa] サービスワーカーを登録できませんでした", err);
        });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  return null;
}
