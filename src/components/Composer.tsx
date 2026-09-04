"use client";

import { useEffect, useRef, useState } from "react";
import type { DraftEvents } from "@/types/goal";

/**
 * 送信ロック中も入力はできる。考えながら書けるようにするため。
 * ロック中の打鍵・削除を記録し、H4（待ち時間は回答の質を上げるか）の判定に使う。
 */
export function Composer({
  disabled,
  locked,
  lockStartedAt,
  onSend,
}: {
  disabled: boolean;
  locked: boolean;
  lockStartedAt: number | null;
  onSend: (text: string, draft?: DraftEvents) => void;
}) {
  const [text, setText] = useState("");
  const prevLen = useRef(0);
  const draft = useRef<DraftEvents | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // ロックが始まったら計測をリセットする
  useEffect(() => {
    if (locked && lockStartedAt) {
      draft.current = {
        lockDurationMs: 0,
        charsTyped: 0,
        charsDeleted: 0,
        firstKeystrokeAtMs: null,
      };
      prevLen.current = text.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, lockStartedAt]);

  function handleChange(v: string) {
    if (locked && draft.current && lockStartedAt) {
      const delta = v.length - prevLen.current;
      if (delta > 0) draft.current.charsTyped += delta;
      else draft.current.charsDeleted += -delta;
      if (draft.current.firstKeystrokeAtMs === null) {
        draft.current.firstKeystrokeAtMs = Date.now() - lockStartedAt;
      }
    }
    prevLen.current = v.length;
    setText(v);
  }

  function submit() {
    const t = text.trim();
    if (!t || disabled || locked) return;

    let d: DraftEvents | undefined;
    if (draft.current && lockStartedAt) {
      d = { ...draft.current, lockDurationMs: Date.now() - lockStartedAt };
      draft.current = null;
    }

    onSend(t, d);
    setText("");
    prevLen.current = 0;
    taRef.current?.focus();
  }

  const canSend = text.trim().length > 0 && !disabled && !locked;

  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder={locked ? "考えながら書いておけます" : "答えを書く"}
        // サーバー側の上限（4000字）と揃える。UI側だけの制限は検証の代わりに
        // ならないが、送ってから弾かれるより、打てないほうが親切
        maxLength={4000}
        className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] leading-relaxed outline-none placeholder:text-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
        style={{ fieldSizing: "content" } as React.CSSProperties}
      />
      <button
        type="button"
        onClick={submit}
        disabled={!canSend}
        className="h-[44px] shrink-0 rounded-xl bg-indigo px-4 text-[13px] font-medium text-surface transition-opacity disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        送信
      </button>
    </div>
  );
}
