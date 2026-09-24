"use client";

import { useEffect, useState } from "react";
import { installMode, type InstallMode } from "@/lib/pwa";
import {
  clearInstallPrompt,
  getInstallPrompt,
  onInstallPromptChange,
} from "@/components/PwaBoot";

/**
 * 「スマホアプリとして入れる」ボタン。
 *
 * ブラウザごとに入れ方が違うので、出すものを変える（判断は lib/pwa.ts）。
 *   prompt  … ボタンでそのままインストールのダイアログを出す（Android の Chrome など）
 *   ios     … 共有 →「ホーム画面に追加」の手順を出す（ページから呼ぶ手段が無い）
 *   manual  … ブラウザのメニューから入れる案内
 *   installed … アプリとして開いているので、何も出さない
 *
 * ■ iPhone の注意書きは消さない
 * iPhone ではホーム画面のアプリと Safari で保存場所が別になる。
 * ログインしていないと、Safari で作った目標がアプリ側に出てこない。
 * 「消えた」と思わせないために、入れる前に必ず伝える。
 */
export function InstallCard() {
  const [mode, setMode] = useState<InstallMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const decide = () =>
      setMode(
        installMode({
          standalone:
            window.matchMedia("(display-mode: standalone)").matches ||
            // iPhone のホーム画面から開いたときはこちらで分かる
            (navigator as Navigator & { standalone?: boolean }).standalone === true,
          hasPrompt: getInstallPrompt() !== null,
          userAgent: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints ?? 0,
        }),
      );
    decide();
    return onInstallPromptChange(decide);
  }, []);

  // 判断がつくまで（サーバー側の描画中）は何も出さない。ちらつかせない
  if (mode === null || mode === "installed") return null;

  async function install() {
    const p = getInstallPrompt();
    if (!p) return;
    setBusy(true);
    try {
      await p.prompt();
      const { outcome } = await p.userChoice;
      if (outcome === "accepted") setDone(true);
    } finally {
      // 同じダイアログは2回出せない（ブラウザの仕様）
      clearInstallPrompt();
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="install-title"
      className="rounded-xl border border-accent-line bg-accent-soft px-4 py-4"
    >
      <h2 id="install-title" className="text-[14px] font-medium text-ink">
        スマホアプリとして使う
      </h2>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        ホーム画面にアイコンが置かれ、アドレスバー無しの全画面で開けます。
        電波が無いときも、最後に開いた画面は表示されます。
      </p>

      {done ? (
        <p role="status" className="mt-3 text-[13px] text-accent">
          インストールしました。ホーム画面のアイコンから開けます。
        </p>
      ) : mode === "prompt" ? (
        <button
          type="button"
          onClick={install}
          disabled={busy}
          className="mt-3 min-h-11 w-full rounded-lg bg-indigo px-4 text-[14px] font-medium text-surface disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {busy ? "確認しています…" : "アプリをインストール"}
        </button>
      ) : mode === "ios" ? (
        <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-relaxed text-ink">
          <li>
            画面下（iPadは上）の<b>共有ボタン</b>（四角から矢印が出ているマーク）を押す
          </li>
          <li>
            一覧を下へずらして<b>「ホーム画面に追加」</b>を押す
          </li>
          <li>右上の「追加」を押す</li>
        </ol>
      ) : (
        <p className="mt-3 text-[13px] leading-relaxed text-ink">
          ブラウザのメニュー（︙ や …）から<b>「アプリをインストール」</b>または
          <b>「ホーム画面に追加」</b>を選んでください。見つからないときは、
          Android は Chrome、iPhone は Safari で開くと入れられます。
        </p>
      )}

      {mode === "ios" && !done && (
        <p className="mt-3 rounded-lg border border-line bg-surface px-3 py-2 text-[12px] leading-relaxed text-muted">
          iPhone では、ホーム画面のアプリと Safari で<b>保存場所が別</b>になります。
          いまの記録をアプリ側でも使うには、先に設定からログインしておくか
          （クラウドに同期されます）、JSONで書き出してアプリ側で読み込んでください。
        </p>
      )}
    </section>
  );
}
