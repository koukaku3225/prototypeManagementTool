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
import {
  applyCalendarReconnect,
  calendarChanged,
} from "../src/lib/calendar/reconnect.ts";

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

/**
 * localStorage の代わり。
 *
 * 実物と同じく「全期間の枠」を返し、save は1件ずつ置き換える。
 * 送信用に期間で絞った配列ではないことが、この修正の要点そのもの。
 */
function fakeStorage(boxes, flag) {
  const state = { boxes: boxes.map((b) => ({ ...b })), flag, writes: 0 };
  return {
    state,
    loadAll: () => state.boxes.map((b) => ({ ...b })),
    save: (box) => {
      state.writes++;
      const i = state.boxes.findIndex((b) => b.id === box.id);
      if (i >= 0) state.boxes[i] = { ...box };
      else state.boxes.push({ ...box });
    },
    readFlag: () => state.flag,
    writeFlag: (v) => {
      state.flag = v;
    },
  };
}

const boxes = () => [
  { id: "b1", date: "2026-09-10", googleEventId: "ev-1" },
  { id: "b2", date: "2026-09-11", googleEventId: "ev-2" },
  { id: "b3", date: "2026-09-12", googleEventId: null },
];

// --- 判定そのもの ---------------------------------------------------------

t("繋ぎ直しの判定：違うカレンダーなら true", () => {
  assert.equal(
    calendarChanged({ previousCalendarId: "old", currentCalendarId: "new" }),
    true,
  );
});

t("繋ぎ直しの判定：同じなら false", () => {
  assert.equal(
    calendarChanged({ previousCalendarId: "same", currentCalendarId: "same" }),
    false,
  );
});

t("繋ぎ直しの判定：初回（前回不明）は false", () => {
  // 初回に落とすと、既にカレンダーにある予定を作り直して重複させる
  assert.equal(
    calendarChanged({ previousCalendarId: null, currentCalendarId: "cal" }),
    false,
  );
});

t("繋ぎ直しの判定：現在不明なら false", () => {
  // 状態取得に失敗しただけで全IDを落とすと、次の同期で全件作り直しになる
  assert.equal(
    calendarChanged({ previousCalendarId: "old", currentCalendarId: null }),
    false,
  );
});

// --- localStorage への反映 ------------------------------------------------

t("【回帰】カレンダーが変わったら、保存されている枠のIDを全部落とす", () => {
  // 落とさないと、新カレンダーに無い＝削除された、と判定されて時間割が消える
  const s = fakeStorage(boxes(), "old-cal");
  const r = applyCalendarReconnect({ currentCalendarId: "new-cal", storage: s });

  assert.equal(r.changed, true);
  assert.equal(r.cleared, 2, "IDを持つ2件だけ書き換わるはず");
  assert.deepEqual(
    s.state.boxes.map((b) => b.googleEventId),
    [null, null, null],
  );
});

t("【回帰】送信範囲の外にある枠も落とす（+120日）", () => {
  /*
   * 2026-09-08 指摘1の中核。
   * 送信は -14〜+90日、サーバーの処理窓は -7〜+60日。
   * 送るデータの中だけでIDを落としていたので、+120日の枠は
   * 古いIDを持ったまま残り、日が近づいて処理窓に入った瞬間に
   * 「カレンダー側で削除された」と誤判定されて消えていた。
   */
  const far = [
    { id: "near", date: "2026-09-10", googleEventId: "ev-near" },
    { id: "far", date: "2027-01-06", googleEventId: "ev-far" },
  ];
  const s = fakeStorage(far, "old-cal");
  applyCalendarReconnect({ currentCalendarId: "new-cal", storage: s });

  assert.equal(
    s.state.boxes.find((b) => b.id === "far").googleEventId,
    null,
    "送信範囲の外にある枠に古いIDが残っている（時間差で消える経路）",
  );
});

t("【回帰】カレンダーが同じなら、1件も書き換えない", () => {
  // 落とすと毎回作り直され、カレンダー側で予定が増殖する
  const s = fakeStorage(boxes(), "same-cal");
  const r = applyCalendarReconnect({ currentCalendarId: "same-cal", storage: s });

  assert.equal(r.changed, false);
  assert.equal(s.state.writes, 0, "書き込みが起きている");
  assert.deepEqual(
    s.state.boxes.map((b) => b.googleEventId),
    ["ev-1", "ev-2", null],
  );
});

t("この端末で初めて同期するときは落とさない", () => {
  const s = fakeStorage(boxes(), null);
  const r = applyCalendarReconnect({ currentCalendarId: "cal", storage: s });

  assert.equal(r.changed, false);
  assert.equal(s.state.boxes[0].googleEventId, "ev-1");
});

t("【回帰】初回でも目印は書く（次の繋ぎ直しを検知できるように）", () => {
  /*
   * 以前は同期の成功後にだけ目印を書いていた。同期に一度も成功していない
   * 端末は目印が null のままなので、次に繋ぎ直しても「初回」と判定され、
   * 古いIDが落ちずに時間割が消える。
   */
  const s = fakeStorage(boxes(), null);
  applyCalendarReconnect({ currentCalendarId: "cal", storage: s });
  assert.equal(s.state.flag, "cal");
});

t("落とし終わってから目印を書く", () => {
  const s = fakeStorage(boxes(), "old-cal");
  const seen = [];
  const spied = {
    ...s,
    save: (b) => {
      seen.push("save");
      s.save(b);
    },
    writeFlag: (v) => {
      seen.push("flag");
      s.writeFlag(v);
    },
  };
  applyCalendarReconnect({ currentCalendarId: "new-cal", storage: spied });

  assert.equal(seen.at(-1), "flag", "目印が先に書かれている");
  assert.equal(seen.filter((x) => x === "save").length, 2);
  assert.equal(s.state.flag, "new-cal");
});

t("連携状態が分からないときは、落としも目印の更新もしない", () => {
  const s = fakeStorage(boxes(), "old-cal");
  const r = applyCalendarReconnect({ currentCalendarId: null, storage: s });

  assert.equal(r.changed, false);
  assert.equal(s.state.writes, 0);
  assert.equal(s.state.flag, "old-cal", "判断材料の目印を消してはいけない");
  assert.equal(s.state.boxes[0].googleEventId, "ev-1");
});

t("落とすのはIDだけで、他の項目は保つ", () => {
  const s = fakeStorage(
    [{ id: "b1", title: "予定", cardId: "c1", googleEventId: "ev-1" }],
    "a",
  );
  applyCalendarReconnect({ currentCalendarId: "b", storage: s });

  assert.equal(s.state.boxes[0].title, "予定");
  assert.equal(s.state.boxes[0].cardId, "c1");
  assert.equal(s.state.boxes[0].id, "b1");
  assert.equal(s.state.boxes[0].googleEventId, null);
});

t("【回帰】2回目の同期では、もう落とさない", () => {
  // 1回目で localStorage も目印も片付いているので、2回目は何もしない。
  // ここで落とし続けると、作ったばかりの予定を毎回作り直して増殖する
  const s = fakeStorage(boxes(), "old-cal");
  applyCalendarReconnect({ currentCalendarId: "new-cal", storage: s });
  const writesAfterFirst = s.state.writes;

  const r = applyCalendarReconnect({ currentCalendarId: "new-cal", storage: s });
  assert.equal(r.changed, false);
  assert.equal(s.state.writes, writesAfterFirst);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
