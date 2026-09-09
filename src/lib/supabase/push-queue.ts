/**
 * クラウドへの押し出しを、キーごとにまとめて送るための待ち行列。
 *
 * ■ 何が問題だったか
 * 予定シート（TimeBoxSheet）と習慣の編集（HabitEditor）は、
 * 「項目が少ないので保存ボタンを押させない」方針で、1文字打つたびに
 * write() を呼ぶ。localStorage 側はそれでよいが、write() の裏で走る
 * Supabase 同期は **そのキーの全行を毎回 upsert** する。
 * 3文の振り返りを書くと、数十〜百回超の全件送信になる。
 * 回線が一瞬詰まると1回失敗し、「クラウドへの保存が止まっています」の帯が
 * 理由なく明滅する（次のキーで自己回復するので、原因も残らない）。
 *
 * ■ どう直したか
 * 打ち終わりを待ってから1回だけ送る（末尾デバウンス）。
 * localStorage への書き込みは同期のまま一切遅らせない。
 * 遅れるのはクラウドへの反映だけで、失敗しても手元のデータは無事、
 * という既存の性質は変えていない。
 *
 * ■ 遅らせないもの
 * - 対象キー以外（目標カード・大きな物語・対話ログなど）。
 *   これらは編集の確定時にしか書かれないので、まとめる意味がない。
 * - `value === null`（そのキーを丸ごと消した）。
 *   消去は数が出ないうえ、遅らせると「消したのに別端末に残る」窓が伸びる。
 *
 * ■ 取りこぼさないために
 * タブを閉じる・隠す瞬間に flush() を呼ぶ（SyncBoot が繋いでいる）。
 * それでも落ちたときは localStorage 側に残っているので、
 * 次にそのキーを書いた時点でクラウドに追いつく。
 */

/** 打ち終わりを待つ時間。LocalBackupBoot の4秒より短くしてある */
export const PUSH_DEBOUNCE_MS = 1500;

export interface PushQueue {
  /** 1回の書き込みを受け取る。対象キーならまとめ、それ以外は即送る */
  push(key: string, value: unknown): void;
  /** 待っているものを、いますべて送る */
  flush(): void;
  /** 待っているものを、送らずに捨てる */
  cancel(): void;
  /** いま待っているキー（テストと診断のため。順序は受け取った順） */
  pendingKeys(): string[];
}

export interface PushQueueOptions {
  /** まとめる対象のキー。ここに無いキーは素通しする */
  debounced: readonly string[];
  send: (key: string, value: unknown) => void;
  waitMs?: number;
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (id: number) => void;
}

export function createPushQueue(opts: PushQueueOptions): PushQueue {
  const waitMs = opts.waitMs ?? PUSH_DEBOUNCE_MS;
  const targets = new Set(opts.debounced);
  const setTimer =
    opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id));

  /** キー → いちばん新しい値と、その待ちタイマー。Map は挿入順を保つ */
  const pending = new Map<string, { value: unknown; timer: number }>();

  function drop(key: string): void {
    const prev = pending.get(key);
    if (!prev) return;
    clearTimer(prev.timer);
    pending.delete(key);
  }

  return {
    push(key, value) {
      /*
       * 素通しするものが待ち行列に残っていることは無いが、
       * 「消した」が待ちを追い越して先に届くと、そのあとで古い値が
       * 上書きで戻ってしまう。先に待ちを捨ててから送る。
       */
      if (!targets.has(key) || value === null) {
        drop(key);
        opts.send(key, value);
        return;
      }
      drop(key);
      const timer = setTimer(() => {
        const entry = pending.get(key);
        pending.delete(key);
        if (entry) opts.send(key, entry.value);
      }, waitMs);
      pending.set(key, { value, timer });
    },

    flush() {
      const entries = [...pending.entries()];
      for (const [, e] of entries) clearTimer(e.timer);
      pending.clear();
      for (const [key, e] of entries) opts.send(key, e.value);
    },

    cancel() {
      for (const e of pending.values()) clearTimer(e.timer);
      pending.clear();
    },

    pendingKeys() {
      return [...pending.keys()];
    },
  };
}
