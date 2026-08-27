"use client";

import { useEffect, useState } from "react";
import {
  dismissStorageFailure,
  getStorageFailure,
  onStorageFailure,
  type StorageFailure,
} from "@/lib/storage";

/**
 * 保存に失敗したことを伝える帯。
 *
 * 黙って消えるより、鬱陶しくても知らせるほうがましである。
 * 画面上部に固定するのは、対話中でも編集中でも目に入る必要があるため。
 * 自動では消さない（次の保存が成功したときだけ消える）。
 */
export function StorageAlert() {
  const [failure, setFailure] = useState<StorageFailure | null>(null);

  useEffect(() => {
    setFailure(getStorageFailure());
    return onStorageFailure(setFailure);
  }, []);

  if (!failure) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-50 border-b border-accent bg-accent-soft px-5 py-3"
    >
      <div className="phone flex items-start gap-3">
        <span className="min-w-0 flex-1 text-[13px] leading-relaxed text-accent">
          <strong className="block font-medium">保存できませんでした。</strong>
          {failure.quota ? (
            <>
              このブラウザの保存容量がいっぱいです。設定画面から古い対話の記録を
              書き出して、いくつか消してください。
            </>
          ) : (
            <>
              このブラウザでは保存が許可されていないようです。
              プライベートモードで開いていないか確認してください。
            </>
          )}
          <span className="mt-1 block font-mono text-[10.5px] opacity-70">
            {failure.key} / {new Date(failure.at).toLocaleTimeString("ja-JP")}
          </span>
        </span>
        <button
          type="button"
          onClick={dismissStorageFailure}
          aria-label="この警告を閉じる"
          className="shrink-0 rounded-md border border-accent-line px-2 py-1 text-[11.5px] text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
