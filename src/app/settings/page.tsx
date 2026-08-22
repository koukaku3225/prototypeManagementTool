"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { download } from "@/lib/export";
import {
  applySnapshot,
  captureState,
  deleteSnapshot,
  importStateJson,
  listSnapshots,
  resetAll,
  saveSnapshot,
  type Snapshot,
} from "@/lib/storage";

/**
 * 設定と開発用の道具箱。
 * 毎回ゼロから対話をやり直すのは手間もAPIコストもかかるので、
 * 状態に名前を付けて保存し、ワンクリックで戻せるようにしてある。
 */
export default function SettingsPage() {
  const router = useRouter();
  const [snaps, setSnaps] = useState<Snapshot[]>([]);
  const [name, setName] = useState("");
  const [json, setJson] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => setSnaps(listSnapshots()), []);

  function flash(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(null), 2500);
  }

  return (
    <>
      <AppHeader title="設定" />
      <main className="phone flex flex-1 flex-col px-5 py-6">
        {msg && (
          <p
            role="status"
            className="mb-3 rounded-lg border border-accent-line bg-accent-soft px-3.5 py-2.5 text-[12.5px] text-accent"
          >
            {msg}
          </p>
        )}

        {/* ── スナップショット ─────────────────── */}
        <section className="rounded-xl border border-line bg-surface px-4 py-4">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
            スナップショット
          </h2>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
            いまの状態（大きな物語・目標・対話・プロフィール）に名前を付けて残します。
            動作確認のたびに入力し直す必要がなくなります。
          </p>

          <div className="mt-3 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 卓球テスト用"
              className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
              aria-label="スナップショットの名前"
            />
            <button
              type="button"
              onClick={() => {
                saveSnapshot(name);
                setName("");
                setSnaps(listSnapshots());
                flash("いまの状態を保存しました");
              }}
              className="shrink-0 rounded-lg bg-indigo px-3.5 py-2 text-[13px] text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              保存
            </button>
          </div>

          {snaps.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-muted">まだありません。</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {snaps.map((s) => (
                <li
                  key={s.id}
                  className="rounded-lg border border-line bg-paper px-3 py-2.5"
                >
                  <p className="text-[13px] font-medium">{s.name}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-muted">
                    {new Date(s.createdAt).toLocaleString("ja-JP")}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (applySnapshot(s.id)) {
                          flash("復元しました");
                          router.refresh();
                          setTimeout(() => router.push("/"), 400);
                        }
                      }}
                      className="rounded-md border border-accent-line bg-accent-soft px-2.5 py-1 text-[12px] text-accent"
                    >
                      この状態に戻す
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        deleteSnapshot(s.id);
                        setSnaps(listSnapshots());
                      }}
                      className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted"
                    >
                      消す
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── 書き出し / 読み込み ───────────────── */}
        <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-4">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
            書き出し / 読み込み
          </h2>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() =>
                download(
                  `goal-coach-state-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify(captureState(), null, 2),
                  "application/json",
                )
              }
              className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-[13px]"
            >
              JSONで書き出す
            </button>
            <button
              type="button"
              onClick={() => {
                setJson(JSON.stringify(captureState(), null, 2));
                flash("下の欄に書き出しました。コピーして保管できます");
              }}
              className="flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-[13px]"
            >
              下の欄に出す
            </button>
          </div>

          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={5}
            placeholder="ここにJSONを貼り付けて「読み込む」"
            className="mt-2 w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-accent/25"
            aria-label="状態のJSON"
          />
          <button
            type="button"
            onClick={() => {
              if (importStateJson(json)) {
                flash("読み込みました");
                setTimeout(() => router.push("/"), 400);
              } else {
                flash("読み込めませんでした。JSONの形を確認してください");
              }
            }}
            className="mt-2 w-full rounded-lg bg-indigo px-3 py-2 text-[13px] text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            読み込む
          </button>
        </section>

        {/* ── その他 ─────────────────────────── */}
        <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-4">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted">
            そのほか
          </h2>
          <Link
            href="/metrics"
            className="mt-2.5 block text-[13px] underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            内部計測を見る（M1〜M7）
          </Link>

          <div className="mt-4">
            {confirmReset ? (
              <div className="rounded-lg border border-line bg-paper px-3 py-2.5">
                <p className="text-[12.5px] leading-relaxed">
                  すべて消えます。先にスナップショットを取っておいてください。
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      resetAll();
                      router.push("/");
                    }}
                    className="rounded-md bg-accent px-2.5 py-1 text-[12px] text-surface"
                  >
                    全部消す
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="rounded-md border border-line px-2.5 py-1 text-[12px] text-muted"
                  >
                    やめる
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="text-[12.5px] text-muted underline"
              >
                すべて消してやり直す
              </button>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
