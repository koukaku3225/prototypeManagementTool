"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { structuringMessage } from "@/lib/structuring-wait";

/**
 * 整理（/api/structure）の待ち中に出す画面。/big と /card で共通。
 * 実測で75秒前後かかるため、経過時間で文言を変えて「止まっていない」ことを伝える。
 */
export function StructuringWait() {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <AppHeader locked lockedNote="整理中は移動できません" />
      <main className="phone flex flex-1 flex-col items-center justify-center gap-3 px-5">
        <div className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 animate-pulse rounded-full bg-accent"
              style={{ animationDelay: `${i * 160}ms` }}
            />
          ))}
        </div>
        <p className="text-[14px] text-muted" aria-live="polite">
          {structuringMessage(elapsedMs)}
        </p>
      </main>
    </>
  );
}
