"use client";

import { useEffect } from "react";

/**
 * 動かしたあとに出る帯。
 *
 * ドラッグは誤操作しやすい。指が滑って15分ずれても、
 * 元がどこだったか覚えていないと戻せない。
 * Googleカレンダーのモバイルアプリも、動かした直後に取り消しを出す。
 *
 * 数秒で自動的に消えるが、消えても操作は残る（取り消せなくなるだけ）。
 */
export function Snackbar({
  message,
  actionLabel,
  onAction,
  onDismiss,
  ms = 6000,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  ms?: number;
}) {
  useEffect(() => {
    const id = setTimeout(onDismiss, ms);
    return () => clearTimeout(id);
  }, [message, ms, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ bottom: "calc(var(--bottom-nav-h) + env(safe-area-inset-bottom) + 12px)" }}
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-5"
    >
      <div className="pointer-events-auto flex max-w-[420px] items-center gap-3 rounded-xl border border-line bg-ink px-4 py-2 text-surface shadow-lg">
        <span className="min-w-0 flex-1 text-[13px] leading-snug">{message}</span>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={() => {
              onAction();
              onDismiss();
            }}
            className="min-h-11 shrink-0 rounded-lg border border-[color:var(--c-amber-fg)] px-3.5 text-[13.5px] font-medium text-[color:var(--c-amber-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
