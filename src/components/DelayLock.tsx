"use client";

import { useEffect, useState } from "react";

/**
 * フェーズ2・3の「なぜ」の問いでだけ発動する送信ロック。
 * 入力欄は開いたまま、送信だけを止める。スキップボタンは置かない
 * （置けば必ず押されるため）。
 */
export function DelayLock({
  until,
  onExpire,
}: {
  until: number;
  onExpire: () => void;
}) {
  const [remain, setRemain] = useState(() =>
    Math.max(0, Math.ceil((until - Date.now()) / 1000)),
  );

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setRemain(left);
      if (left <= 0) {
        clearInterval(id);
        onExpire();
      }
    }, 200);
    return () => clearInterval(id);
  }, [until, onExpire]);

  const total = 60;
  const filled = Math.round(((total - remain) / total) * 10);

  return (
    <div
      className="rounded-lg border border-accent-line bg-accent-soft px-4 py-3"
      role="status"
      aria-live="polite"
    >
      <p className="text-[13px] leading-relaxed text-ink">
        すぐに答えなくていいです。
        <br />1 分だけ、考えてみてください。
      </p>
      <div className="mt-2.5 flex items-center gap-2.5">
        <div className="flex gap-1" aria-hidden="true">
          {Array.from({ length: 10 }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 w-3 rounded-full ${
                i < filled ? "bg-accent" : "bg-accent-line/40"
              }`}
            />
          ))}
        </div>
        <span className="font-mono text-[12px] tabular-nums text-accent">
          {remain}秒
        </span>
      </div>
    </div>
  );
}
