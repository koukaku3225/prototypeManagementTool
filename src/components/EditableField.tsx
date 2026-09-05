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
        {/*
          押せることが見て分かる形にする。
          枠も背景も無い文字だけだと、本文の一部にしか見えず
          「編集ボタンが分かりにくい」と実際に迷わせた。
          主操作ではないので色は使わず、輪郭と面で「押せる」だけを伝える。
        */}
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`${label}を編集`}
          className="flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 text-[11.5px] text-muted hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M11.5 2.5a1.7 1.7 0 0 1 2.4 2.4L5.4 13.4l-3.2.8.8-3.2 8.5-8.5Z" />
          </svg>
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
