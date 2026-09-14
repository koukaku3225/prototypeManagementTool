/**
 * 時間割 → /api/calendar/sync に送る本文と、API の入力スキーマのかみ合わせ。
 *
 * 2026-09-14 の一方向化（943c81b）で、画面側は枠から hasNotes を外して送るようにしたが、
 * API のスキーマは hasNotes を必須のまま残っていた。枠が1件でもあると必ず 400 になり、
 * **専用カレンダーへの同期が本番で丸ごと止まっていた**（2026-09-15 に本番の通信で確認）。
 * エンジンのテストも判断表のテストも、画面が作る本文をスキーマに通していなかったので捕まらなかった。
 * ここでは「画面が実際に作る本文」をそのままスキーマに通す。
 *
 * 実行は `npm test`。
 */
import assert from "node:assert/strict";
import { CalendarSyncRequestSchema } from "../src/lib/api-schema.ts";
import { buildSyncBoxes } from "../src/lib/calendar/payload.ts";

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}`);
  }
}

const meta = { obstacle: "", ifThen: "", location: "" };
const box = (over = {}) => ({
  id: "9a82b5c1-56cd-48d7-8bb5-dc7efd4b36a6",
  date: "2026-09-15",
  start: "09:00",
  end: "10:00",
  title: "読書",
  cardId: null,
  color: null,
  habitId: null,
  meta,
  completedAt: null,
  review: null,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
  ...over,
});

t("画面が作る本文は、API のスキーマを通る（hasNotes を送らなくても 400 にならない）", () => {
  const boxes = buildSyncBoxes(
    [
      box(),
      box({ id: "b2", googleEventId: "ev1", review: { good: "よかった", bad: "", next: "", score: 4 } }),
      box({ id: "b3", title: "", completedAt: "2026-09-15T01:00:00.000Z" }),
    ],
    "2026-09-01",
    "2026-12-31",
  );
  assert.equal(boxes.length, 3);
  const r = CalendarSyncRequestSchema.safeParse({ boxes, confirmDeletes: false });
  assert.ok(r.success, r.success ? "" : JSON.stringify(r.error.issues));
});

t("以前の画面（hasNotes・updatedAt 付き）が送ってきても弾かない", () => {
  const r = CalendarSyncRequestSchema.safeParse({
    boxes: [
      {
        id: "b1",
        date: "2026-09-15",
        start: "09:00",
        end: "10:00",
        title: "x",
        googleEventId: null,
        updatedAt: "2026-09-14T00:00:00.000Z",
        hasNotes: true,
      },
    ],
  });
  assert.ok(r.success);
});

t("期間の外・非表示・メインカレンダーから取り込んだ枠は送らない", () => {
  const boxes = buildSyncBoxes(
    [
      box({ id: "in" }),
      box({ id: "before", date: "2026-08-31" }),
      box({ id: "after", date: "2027-01-01" }),
      box({ id: "google", source: "google", sourceEventId: "g1" }),
      box({ id: "hidden", hiddenAt: "2026-09-14T00:00:00.000Z" }),
    ],
    "2026-09-01",
    "2026-12-31",
  );
  assert.deepEqual(
    boxes.map((b) => b.id),
    ["in"],
  );
});

t("送るのは同期に要る項目だけ（書き込み・目標は外に出さない）", () => {
  const [b] = buildSyncBoxes(
    [box({ review: { good: "秘密のメモ", bad: "", next: "", score: null }, cardId: "c1" })],
    "2026-09-01",
    "2026-12-31",
  );
  assert.deepEqual(Object.keys(b).sort(), ["date", "end", "googleEventId", "id", "start", "title"]);
  assert.equal(b.googleEventId, null);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
