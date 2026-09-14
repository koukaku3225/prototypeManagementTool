/**
 * メインカレンダーの取り込み（primary.ts）のテスト。
 *
 * 取り込みは「Google の予定の一覧」と「アプリの枠（非表示を含む全件）」を突き合わせて、
 * 足す・直す・消すを決める。I/O は持たないので、組み合わせをここで固定する。
 * 実行は `npm test`。
 */
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import {
  hasNotesOrDone,
  mergePrimary,
  normalizePrimaryEvents,
  PRIMARY_DELETE_BRAKE,
  primaryBoxId,
} from "../src/lib/calendar/primary.ts";
import { isValidUuid } from "../src/lib/uuid.ts";

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

const WINDOW = { from: "2026-09-08", to: "2026-11-14" };
const NOW = "2026-09-15T01:00:00.000Z";

const ev = (over = {}) => ({
  eventId: "e1",
  boxId: primaryBoxId("e1"),
  title: "飯",
  date: "2026-09-15",
  start: "12:00",
  end: "13:00",
  ...over,
});

const gbox = (over = {}) => ({
  id: primaryBoxId("e1"),
  date: "2026-09-15",
  start: "12:00",
  end: "13:00",
  title: "飯",
  cardId: null,
  color: null,
  meta: { why: "", obstacle: "", counter: "" },
  completedAt: null,
  review: null,
  source: "google",
  sourceEventId: "e1",
  hiddenAt: null,
  sourceGoneAt: null,
  createdAt: "2026-09-14T00:00:00.000Z",
  ...over,
});

// ---------------------------------------------------------------- ID

t("枠のIDは予定IDから毎回同じ値になり、UUIDの形をしている", () => {
  // 別端末で同時に取り込んでも同じ行に重なり、2件にならない
  assert.equal(primaryBoxId("abc_20260915T030000Z"), primaryBoxId("abc_20260915T030000Z"));
  assert.notEqual(primaryBoxId("a"), primaryBoxId("b"));
  assert.ok(isValidUuid(primaryBoxId("a")), "Supabase の uuid 列に入らない");
});

// ---------------------------------------------------------------- Google の予定を整える

const raw = (over = {}) => ({
  id: "r1",
  status: "confirmed",
  summary: "筋トレ",
  start: { dateTime: "2026-09-15T13:00:00+09:00" },
  end: { dateTime: "2026-09-15T14:00:00+09:00" },
  ...over,
});

t("時刻のある予定を JST の日付・時刻にする", () => {
  const [e] = normalizePrimaryEvents([raw()]);
  assert.deepEqual(
    { ...e, boxId: undefined },
    { eventId: "r1", boxId: undefined, title: "筋トレ", date: "2026-09-15", start: "13:00", end: "14:00" },
  );
  assert.equal(e.boxId, primaryBoxId("r1"));
});

t("削除済み・終日・日をまたぐ予定は落とす", () => {
  const out = normalizePrimaryEvents([
    raw({ id: "c", status: "cancelled" }),
    raw({ id: "allday", start: { date: "2026-09-15" }, end: { date: "2026-09-16" } }),
    raw({
      id: "cross",
      start: { dateTime: "2026-09-15T22:00:00+09:00" },
      end: { dateTime: "2026-09-16T02:00:00+09:00" },
    }),
  ]);
  assert.deepEqual(out, []);
});

t("23:00〜翌0:00 は 23:00〜24:00 として残す", () => {
  const [e] = normalizePrimaryEvents([
    raw({ start: { dateTime: "2026-09-15T23:00:00+09:00" }, end: { dateTime: "2026-09-16T00:00:00+09:00" } }),
  ]);
  assert.equal(e.date, "2026-09-15");
  assert.equal(e.end, "24:00");
});

t("自分が出席を断った招待は落とす。未回答・承諾は残す", () => {
  const out = normalizePrimaryEvents([
    raw({ id: "no", attendees: [{ self: true, responseStatus: "declined" }] }),
    raw({ id: "maybe", attendees: [{ self: true, responseStatus: "needsAction" }] }),
    raw({ id: "other-declined", attendees: [{ email: "x", responseStatus: "declined" }] }),
  ]);
  assert.deepEqual(out.map((e) => e.eventId), ["maybe", "other-declined"]);
});

t("勤務場所・誕生日などの特殊な予定は落とす", () => {
  const out = normalizePrimaryEvents([
    raw({ id: "wl", eventType: "workingLocation" }),
    raw({ id: "bd", eventType: "birthday" }),
    raw({ id: "focus", eventType: "focusTime" }),
    raw({ id: "normal", eventType: "default" }),
  ]);
  assert.deepEqual(out.map((e) => e.eventId), ["focus", "normal"]);
});

t("タイトルが無い予定は空文字にする（表示側で（未記入））", () => {
  const [e] = normalizePrimaryEvents([raw({ summary: undefined })]);
  assert.equal(e.title, "");
});

// ---------------------------------------------------------------- 突き合わせ

t("予定があって枠が無い → 取り込む", () => {
  const r = mergePrimary([], { ...WINDOW, events: [ev()] }, NOW);
  assert.equal(r.upserts.length, 1);
  const b = r.upserts[0];
  assert.equal(b.id, primaryBoxId("e1"));
  assert.equal(b.source, "google");
  assert.equal(b.sourceEventId, "e1");
  assert.equal(b.title, "飯");
  assert.equal(b.cardId, null);
  assert.equal(b.completedAt, null);
  assert.deepEqual(b.meta, { why: "", obstacle: "", counter: "" });
  assert.deepEqual(r.deletes, []);
});

t("予定があって枠も同じ → 何もしない（書き込みを起こさない）", () => {
  const r = mergePrimary([gbox()], { ...WINDOW, events: [ev()] }, NOW);
  assert.deepEqual(r, { upserts: [], deletes: [], braked: false });
});

t("Google でタイトル・時刻が変わった → Google の値で上書きし、書き込みは守る", () => {
  const box = gbox({
    meta: { why: "大事", obstacle: "", counter: "" },
    completedAt: "2026-09-15T04:00:00.000Z",
    review: { good: "よし", bad: "", next: "", score: 50 },
    cardId: "card-1",
    color: "rose",
  });
  const r = mergePrimary([box], { ...WINDOW, events: [ev({ title: "昼飯", start: "12:30", end: "13:30" })] }, NOW);
  assert.equal(r.upserts.length, 1);
  const u = r.upserts[0];
  assert.equal(u.title, "昼飯");
  assert.equal(u.start, "12:30");
  assert.equal(u.end, "13:30");
  assert.deepEqual(u.meta, box.meta);
  assert.deepEqual(u.review, box.review);
  assert.equal(u.completedAt, box.completedAt);
  assert.equal(u.cardId, "card-1");
  assert.equal(u.color, "rose");
});

t("Google で別の日へ動いた → 日付も追う", () => {
  const r = mergePrimary([gbox()], { ...WINDOW, events: [ev({ date: "2026-09-16" })] }, NOW);
  assert.equal(r.upserts[0].date, "2026-09-16");
});

t("非表示にした枠 → 予定があっても何もしない（復活させない）", () => {
  const r = mergePrimary(
    [gbox({ hiddenAt: "2026-09-14T00:00:00.000Z" })],
    { ...WINDOW, events: [ev({ title: "変わっても" })] },
    NOW,
  );
  assert.deepEqual(r, { upserts: [], deletes: [], braked: false });
});

t("予定が消えた・書き込みなし → 枠を消す", () => {
  const r = mergePrimary([gbox()], { ...WINDOW, events: [] }, NOW);
  assert.deepEqual(r.deletes, [primaryBoxId("e1")]);
  assert.deepEqual(r.upserts, []);
});

t("予定が消えた・事前準備あり → 残して「Googleで削除済み」を付ける", () => {
  const r = mergePrimary([gbox({ meta: { why: "", obstacle: "眠い", counter: "" } })], { ...WINDOW, events: [] }, NOW);
  assert.deepEqual(r.deletes, []);
  assert.equal(r.upserts[0].sourceGoneAt, NOW);
});

t("予定が消えた・完了だけ → 残す", () => {
  const r = mergePrimary([gbox({ completedAt: NOW })], { ...WINDOW, events: [] }, NOW);
  assert.deepEqual(r.deletes, []);
  assert.equal(r.upserts.length, 1);
});

t("すでに削除済みの印がある枠は、書き直さない（毎回の書き込みを起こさない）", () => {
  const r = mergePrimary(
    [gbox({ completedAt: NOW, sourceGoneAt: "2026-09-14T00:00:00.000Z" })],
    { ...WINDOW, events: [] },
    NOW,
  );
  assert.deepEqual(r, { upserts: [], deletes: [], braked: false });
});

t("削除済みの印がある枠の予定が戻ってきた → 印を外す", () => {
  const r = mergePrimary(
    [gbox({ completedAt: NOW, sourceGoneAt: "2026-09-14T00:00:00.000Z" })],
    { ...WINDOW, events: [ev()] },
    NOW,
  );
  assert.equal(r.upserts[0].sourceGoneAt, null);
});

t("予定が消えた・非表示の枠 → 記録ごと片付ける", () => {
  const r = mergePrimary([gbox({ hiddenAt: NOW })], { ...WINDOW, events: [] }, NOW);
  assert.deepEqual(r.deletes, [primaryBoxId("e1")]);
});

t("取得した期間の外にある枠は、予定が見えなくても消さない", () => {
  const r = mergePrimary([gbox({ date: "2026-09-01" })], { ...WINDOW, events: [] }, NOW);
  assert.deepEqual(r, { upserts: [], deletes: [], braked: false });
});

t("期間より前の非表示の記録は片付ける（溜め込まない）", () => {
  const r = mergePrimary([gbox({ date: "2026-09-01", hiddenAt: NOW })], { ...WINDOW, events: [] }, NOW);
  assert.deepEqual(r.deletes, [primaryBoxId("e1")]);
});

t("アプリで作った枠には一切触らない", () => {
  const app = {
    ...gbox(),
    id: "app-1",
    source: undefined,
    sourceEventId: null,
  };
  const r = mergePrimary([app], { ...WINDOW, events: [] }, NOW);
  assert.deepEqual(r, { upserts: [], deletes: [], braked: false });
});

t("旧形式（ID が決まった形でない）の取り込み枠も、予定IDで対応づける", () => {
  const legacy = gbox({ id: "random-uuid" });
  const r = mergePrimary([legacy], { ...WINDOW, events: [ev()] }, NOW);
  assert.deepEqual(r, { upserts: [], deletes: [], braked: false }, "二重に取り込んではいけない");
});

t("【ブレーキ】一度に多く消えるときは消さず、削除済みの印に留める", () => {
  // 別アカウントに繋ぎ直した・Google の一時的な不調で一覧が空、などで全滅させない
  const n = PRIMARY_DELETE_BRAKE + 1;
  const boxes = Array.from({ length: n }, (_, i) =>
    gbox({ id: primaryBoxId(`x${i}`), sourceEventId: `x${i}` }),
  );
  const r = mergePrimary(boxes, { ...WINDOW, events: [] }, NOW);
  assert.equal(r.braked, true);
  assert.deepEqual(r.deletes, []);
  assert.equal(r.upserts.length, n);
  assert.ok(r.upserts.every((b) => b.sourceGoneAt === NOW));
});

t("ブレーキは非表示の記録の片付けには効かない（見えないものなので害が無い）", () => {
  const n = PRIMARY_DELETE_BRAKE + 3;
  const boxes = Array.from({ length: n }, (_, i) =>
    gbox({ id: primaryBoxId(`h${i}`), sourceEventId: `h${i}`, hiddenAt: NOW }),
  );
  const r = mergePrimary(boxes, { ...WINDOW, events: [] }, NOW);
  assert.equal(r.deletes.length, n);
});

t("hasNotesOrDone: 振り返りの中身だけでも書き込みあり", () => {
  assert.equal(hasNotesOrDone(gbox()), false);
  assert.equal(hasNotesOrDone(gbox({ review: { good: "", bad: "", next: "", score: null } })), false);
  assert.equal(hasNotesOrDone(gbox({ review: { good: "", bad: "", next: "", score: 0 } })), true);
  assert.equal(hasNotesOrDone(gbox({ review: { good: "", bad: "x", next: "", score: null } })), true);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
