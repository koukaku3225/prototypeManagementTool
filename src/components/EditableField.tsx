"use client";

import { useEffect, useRef, useState } from "react";

/**
 * その場で書き換えられる欄。
 *
 * 以前は「編集」ボタンを押してから入力欄が開き、「保存」で確定していた。
 * 書くたびに2回余計に押すことになるので、最初から入力欄として出し、
 * 欄を離れた（フォーカスが外れた）ときに保存する。
 *
 * ■ 保存のタイミング
 *   - 欄を離れたとき（他の欄・ボタンを押したとき含む）
 *   - 1行の欄で Enter（日本語の変換を確定する Enter では保存しない）
 *   - 日付の欄は、日付が選ばれた時点（選んだあと、離れずに画面を移っても失わない）
 *   - 離れずに画面を移った（アンマウントされた）ときも、書きかけがあれば保存する
 * Escape で、書きかけを捨てて元の値に戻す。
 *
 * 編集された項目は記録し、AI出力の精度計測（M5）に使う。
 * 呼び出し側の onSave は、値が変わったときだけ呼ばれる。
 */
export function EditableField({
  value,
  label,
  multiline,
  type = "text",
  onSave,
}: {
  value: string;
  label: string;
  multiline?: boolean;
  /** "date" はクラウドの date 列に入る YYYY-MM-DD しか作らせないために使う */
  type?: "text" | "date";
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [savedAt, setSavedAt] = useState(0);
  // 最新の値を、イベントとアンマウント時の後始末から読むための置き場
  const draftRef = useRef(value);
  const valueRef = useRef(value);
  const onSaveRef = useRef(onSave);
  const focusedRef = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    onSaveRef.current = onSave;
    valueRef.current = value;
  });

  // 外から値が変わったら取り込む。ただし入力中は上書きしない（書きかけが消える）
  useEffect(() => {
    if (focusedRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  // 離れずに画面を移ったとき、書きかけを失わない
  useEffect(
    () => () => {
      const next = draftRef.current.trim();
      if (next !== valueRef.current) onSaveRef.current(next);
    },
    [],
  );

  // 複数行は中身に合わせて高さを変える（スクロールさせない）
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, multiline]);

  // 「保存しました」は数秒で消す。保存したと分からないと、書いたものが残ったか不安になる
  useEffect(() => {
    if (!savedAt) return;
    const id = setTimeout(() => setSavedAt(0), 1800);
    return () => clearTimeout(id);
  }, [savedAt]);

  function commit() {
    const next = draftRef.current.trim();
    draftRef.current = next;
    setDraft(next);
    if (next !== valueRef.current) {
      // 先に基準を進める。同じ値で二度呼ばれる（Enter のあとに離れる）のを防ぐ
      valueRef.current = next;
      onSaveRef.current(next);
      setSavedAt(Date.now());
    }
  }

  function revert() {
    draftRef.current = valueRef.current;
    setDraft(valueRef.current);
  }

  const shared =
    "block w-full min-h-11 rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-relaxed outline-none transition-colors placeholder:text-muted focus:border-accent-line focus-visible:ring-2 focus-visible:ring-accent/25";

  const common = {
    value: draft,
    placeholder: "（未記入）",
    "aria-label": label,
    onFocus: () => {
      focusedRef.current = true;
    },
    onBlur: () => {
      focusedRef.current = false;
      commit();
    },
  };

  return (
    <div className="flex flex-col gap-1">
      {multiline ? (
        <textarea
          ref={areaRef}
          rows={2}
          {...common}
          onChange={(e) => {
            draftRef.current = e.target.value;
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // 書きかけを戻すだけ。外側のシートの「Escape で閉じる」まで届かせない
              e.stopPropagation();
              revert();
              e.currentTarget.blur();
            }
          }}
          className={`${shared} resize-none overflow-hidden whitespace-pre-wrap`}
        />
      ) : (
        <input
          type={type}
          {...common}
          onChange={(e) => {
            const v = e.target.value;
            draftRef.current = v;
            setDraft(v);
            // 日付は選んだ時点で確定する。選んで離れずに画面を移ると、離れる前に消える
            if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              revert();
              e.currentTarget.blur();
              return;
            }
            // 日本語入力の変換を確定する Enter は、保存ではない
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.currentTarget.blur();
            }
          }}
          className={shared}
        />
      )}
      <p
        aria-live="polite"
        className={`h-4 text-[11px] leading-4 text-muted transition-opacity ${
          savedAt ? "opacity-100" : "opacity-0"
        }`}
      >
        {savedAt ? "保存しました" : ""}
      </p>
    </div>
  );
}
