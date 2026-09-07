/**
 * 別のカレンダーへ再連携したときに、時間割を消さないことを固定する。
 *
 * 同期エンジンは「送ったIDが取得結果に無い＝削除された」と判断する。
 * 同じカレンダーを見ている限り正しいが、繋ぎ直すと新しいカレンダーには
 * どのIDも無いので、**全部の枠が削除対象になる**。
 * 5件までは無言で消え、それ以上は本人に削除を確認させる形だった。
 *
 * 逆に、変わっていないのに落とすと毎回作り直して予定が増殖する。
 * どちらの事故も起こさないことを、両方向で固定する。実行は `npm test`。
 */
import assert from "node:assert/strict";
import { clearEventIdsIfCalendarChanged } from "../src/lib/calendar/reconnect.ts";

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

const boxes = () => [
  { id: "b1", googleEventId: "ev-1" },
  { id: "b2", googleEventId: "ev-2" },
  { id: "b3", googleEventId: null },
];

t("【回帰】カレンダーが変わったら、古いIDを全部落とす", () => {
  // 落とさないと、新カレンダーに無い＝削除された、と判定されて時間割が消える
  const r = clearEventIdsIfCalendarChanged({
    boxes: boxes(),
    previousCalendarId: "old-cal",
    currentCalendarId: "new-cal",
  });
  assert.equal(r.cleared, true);
  assert.deepEqual(
    r.boxes.map((b) => b.googleEventId),
    [null, null, null],
  );
});

t("【回帰】カレンダーが同じなら、1つも落とさない", () => {
  // 落とすと毎回作り直され、カレンダー側で予定が増殖する
  const r = clearEventIdsIfCalendarChanged({
    boxes: boxes(),
    previousCalendarId: "same-cal",
    currentCalendarId: "same-cal",
  });
  assert.equal(r.cleared, false);
  assert.deepEqual(
    r.boxes.map((b) => b.googleEventId),
    ["ev-1", "ev-2", null],
  );
});

t("この端末で初めて同期するときは落とさない", () => {
  // 初回に落とすと、既にカレンダーにある予定を作り直して重複させる
  const r = clearEventIdsIfCalendarChanged({
    boxes: boxes(),
    previousCalendarId: null,
    currentCalendarId: "cal",
  });
  assert.equal(r.cleared, false);
  assert.equal(r.boxes[0].googleEventId, "ev-1");
});

t("連携状態が分からないときは触らない", () => {
  // 状態取得に失敗しただけで全IDを落とすと、次の同期で全件作り直しになる
  const r = clearEventIdsIfCalendarChanged({
    boxes: boxes(),
    previousCalendarId: "old-cal",
    currentCalendarId: null,
  });
  assert.equal(r.cleared, false);
  assert.equal(r.boxes[0].googleEventId, "ev-1");
});

t("元の配列を書き換えない", () => {
  const original = boxes();
  clearEventIdsIfCalendarChanged({
    boxes: original,
    previousCalendarId: "a",
    currentCalendarId: "b",
  });
  assert.equal(original[0].googleEventId, "ev-1", "呼び出し元の配列が壊れている");
});

t("落とすのはIDだけで、他の項目は保つ", () => {
  const r = clearEventIdsIfCalendarChanged({
    boxes: [{ id: "b1", title: "予定", googleEventId: "ev-1" }],
    previousCalendarId: "a",
    currentCalendarId: "b",
  });
  assert.equal(r.boxes[0].title, "予定");
  assert.equal(r.boxes[0].id, "b1");
});

/*
 * 目印を書く順番の回帰。
 *
 * 送信前に目印を書くと、送信が失敗したときに取り返しがつかない。
 * 落としたIDは送るデータの中だけの話で、localStorage には古いIDが残る。
 * なのに目印だけ新しくなるので、次回は「変わっていない」と判断して
 * 落とさず、古いIDが「削除された」と誤判定されて時間割が消える。
 * CalendarSyncBoot が成功後にだけ書くことを、判定側から見て固定する。
 */
t("【回帰】目印が更新されなければ、次回も必ず落とし直す", () => {
  const first = clearEventIdsIfCalendarChanged({
    boxes: boxes(),
    previousCalendarId: "old-cal",
    currentCalendarId: "new-cal",
  });
  assert.equal(first.cleared, true);

  // 送信が失敗して目印を更新しなかった、という状況を再現する
  const second = clearEventIdsIfCalendarChanged({
    boxes: boxes(), // localStorage には古いIDが残ったまま
    previousCalendarId: "old-cal", // 目印は据え置き
    currentCalendarId: "new-cal",
  });
  assert.equal(second.cleared, true, "2回目で落とさなくなっている（時間割が消える経路）");
  assert.deepEqual(
    second.boxes.map((b) => b.googleEventId),
    [null, null, null],
  );
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
