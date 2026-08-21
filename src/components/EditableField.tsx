"use client";

import { useEffect, useRef, useState } from "react";

/**
 * インライン編集。編集された項目は記録し、AI出力の精度計測（M5）に使う。
 */
export function EditableField({
  value,
  label,
  multiline,
  onSave,
}: {
  value: string;
  label: string;
  multiline?: boolean;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next !== value) onSave(next);
  }

  if (!editing) {
    return (
      <div className="group flex items-start gap-2">
        <p className="flex-1 text-[14px] leading-relaxed whitespace-pre-wrap">
          {value || <span className="text-muted">（未記入）</span>}
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`${label}を編集`}
          className="shrink-0 rounded-md px-2 py-0.5 text-[11px] text-muted hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          編集
        </button>
      </div>
    );
  }

  const shared =
    "w-full rounded-lg border border-accent-line bg-surface px-3 py-2 text-[14px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-accent/25";

  return (
    <div className="flex flex-col gap-2">
      {multiline ? (
        <textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          className={`${shared} resize-none`}
          aria-label={label}
        />
      ) : (
        <input
          ref={ref as React.RefObject<HTMLInputElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className={shared}
          aria-label={label}
        />
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={commit}
          className="rounded-lg bg-indigo px-3 py-1.5 text-[12px] text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          保存
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(value);
            setEditing(false);
          }}
          className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          やめる
        </button>
      </div>
    </div>
  );
}
