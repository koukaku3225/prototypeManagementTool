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
  nextReconnectFlag,
  reconnectBannerSource,
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

// --- 保存に失敗したとき ---------------------------------------------------

/*
 * 2026-09-10 レビュー指摘2の回帰。
 *
 * `write()`（localStorage）は容量超過を握りつぶして false を返すだけで、
 * 例外を投げない。落とすループが1件でも黙って失敗したまま目印を書くと、
 * 「この端末に古いIDはもう無い」という**嘘の目印**が残る。
 * 目印が新カレンダーになった以上、次回以降は changed=false で二度と
 * やり直されず、残った古いIDがサーバーの処理窓に入った日に
 * 「カレンダー側で削除された」と誤判定されて枠が消える。
 * この関数が塞いだはずの穴と、まったく同じ形。
 */

/** 一部の枠だけ保存に失敗する localStorage */
function flakyStorage(boxes, flag, failIds) {
  const s = fakeStorage(boxes, flag);
  const inner = s.save;
  s.save = (box) => {
    if (failIds.includes(box.id)) return false;
    inner(box);
    return true;
  };
  return s;
}

t("【回帰】落とせなかった枠が1件でもあれば、目印を書かない", () => {
  const s = flakyStorage(boxes(), "old-cal", ["b2"]);
  const r = applyCalendarReconnect({ currentCalendarId: "new-cal", storage: s });

  assert.equal(r.changed, true);
  assert.equal(r.cleared, 1, "落とせたのは b1 だけ");
  assert.equal(r.failed, 1, "b2 は落とせていない");
  assert.equal(
    s.state.flag,
    "old-cal",
    "目印を書いてしまうと、次回 changed=false になってやり直せない",
  );
});

t("落とせなかった枠は、次回もう一度やり直せる", () => {
  const s = flakyStorage(boxes(), "old-cal", ["b2"]);
  applyCalendarReconnect({ currentCalendarId: "new-cal", storage: s });
  // 容量が空いた（＝失敗しなくなった）ていで、もう一度通す
  s.save = (box) => {
    const i = s.state.boxes.findIndex((b) => b.id === box.id);
    if (i >= 0) s.state.boxes[i] = { ...box };
    return true;
  };
  const r2 = applyCalendarReconnect({ currentCalendarId: "new-cal", storage: s });

  assert.equal(r2.changed, true, "目印が古いままなので、もう一度検知される");
  assert.equal(r2.failed, 0);
  assert.equal(
    s.state.boxes.every((b) => !b.googleEventId),
    true,
    "残っていた古いIDも落ち切ること",
  );
  assert.equal(s.state.flag, "new-cal", "落とし切れたので今度は目印を書く");
});

t("全部落とせたときは、これまでどおり目印を書く", () => {
  const s = flakyStorage(boxes(), "old-cal", []);
  const r = applyCalendarReconnect({ currentCalendarId: "new-cal", storage: s });
  assert.equal(r.failed, 0);
  assert.equal(s.state.flag, "new-cal");
});

t("save が値を返さない実装（void）は、これまでどおり成功扱い", () => {
  // 画面から渡している実装が boolean を返さなくても壊れないこと
  const s = fakeStorage(boxes(), "old-cal");
  const r = applyCalendarReconnect({ currentCalendarId: "new-cal", storage: s });
  assert.equal(r.cleared, 2);
  assert.equal(r.failed, 0);
  assert.equal(s.state.flag, "new-cal");
});

// --- R12 ①: 連携した時刻（connected_at）で、本物の繋ぎ直しと不審な変化を見分ける ---
//
// いままでは「カレンダーIDが前回と違う」だけで全期間の枠のIDを落としていた。
// status が想定外の値を返しただけでも落ち、落ちた瞬間に目印も新しい値へ移るので
// 自己回復しない（送信窓内は重複予定として作り直され、窓外はIDを失ったまま）。

const T1 = "2026-09-01T00:00:00.000+00:00";
const T2 = "2026-09-14T00:00:00.000+00:00";
const flagOf = (calendarId, connectedAt) => JSON.stringify({ calendarId, connectedAt });

t("IDが違い、連携した時刻も新しい → 本物の繋ぎ直しとして落とす", () => {
  const s = fakeStorage(boxes(), flagOf("old-cal", T1));
  const r = applyCalendarReconnect({ currentCalendarId: "new-cal", currentConnectedAt: T2, storage: s });
  assert.equal(r.changed, true);
  assert.equal(r.suspicious, false);
  assert.equal(r.cleared, 2);
  assert.deepEqual(JSON.parse(s.state.flag), { calendarId: "new-cal", connectedAt: T2 });
});

t("【R12】IDだけ違って連携した時刻が同じ → 不審。落とさず、目印も書かない", () => {
  const s = fakeStorage(boxes(), flagOf("old-cal", T1));
  const r = applyCalendarReconnect({ currentCalendarId: "weird-cal", currentConnectedAt: T1, storage: s });
  assert.equal(r.suspicious, true, "呼び出し側がこの回の同期を見送れるように知らせる");
  assert.equal(r.changed, false);
  assert.equal(r.cleared, 0);
  assert.equal(s.state.writes, 0, "1件も書き換えてはいけない");
  assert.equal(s.state.flag, flagOf("old-cal", T1), "判断材料の目印を上書きしてはいけない");
});

t("【R12】IDが違って連携した時刻が前より古い → 不審", () => {
  const s = fakeStorage(boxes(), flagOf("old-cal", T2));
  const r = applyCalendarReconnect({ currentCalendarId: "new-cal", currentConnectedAt: T1, storage: s });
  assert.equal(r.suspicious, true);
  assert.equal(s.state.writes, 0);
});

t("【R12】IDが違って連携した時刻が取れない → 不審", () => {
  const s = fakeStorage(boxes(), flagOf("old-cal", T1));
  const r = applyCalendarReconnect({ currentCalendarId: "new-cal", currentConnectedAt: null, storage: s });
  assert.equal(r.suspicious, true);
  assert.equal(s.state.writes, 0);
});

t("同じカレンダーなら、時刻が変わっていても落とさず、目印を新しい形で書き直す", () => {
  const s = fakeStorage(boxes(), "cal");
  const r = applyCalendarReconnect({ currentCalendarId: "cal", currentConnectedAt: T2, storage: s });
  assert.equal(r.changed, false);
  assert.equal(r.suspicious, false);
  assert.equal(s.state.writes, 0);
  assert.deepEqual(JSON.parse(s.state.flag), { calendarId: "cal", connectedAt: T2 });
});

t("前の目印が古い形（IDだけ）でIDが違うなら、比べようがないので繋ぎ直しとして扱う", () => {
  // 修正前の端末に残っている目印。ここを不審にすると、本物の繋ぎ直しで永久に同期が止まる
  const s = fakeStorage(boxes(), "old-cal");
  const r = applyCalendarReconnect({ currentCalendarId: "new-cal", currentConnectedAt: T2, storage: s });
  assert.equal(r.changed, true);
  assert.equal(r.suspicious, false);
  assert.equal(r.cleared, 2);
});

t("この端末で初めてなら、時刻付きの目印を書くだけ", () => {
  const s = fakeStorage(boxes(), null);
  const r = applyCalendarReconnect({ currentCalendarId: "cal", currentConnectedAt: T1, storage: s });
  assert.equal(r.changed, false);
  assert.equal(r.suspicious, false);
  assert.equal(s.state.writes, 0);
  assert.deepEqual(JSON.parse(s.state.flag), { calendarId: "cal", connectedAt: T1 });
});

t("目印が壊れていても落ちず、初回として扱う", () => {
  const s = fakeStorage(boxes(), "{壊れた");
  const r = applyCalendarReconnect({ currentCalendarId: "cal", currentConnectedAt: T1, storage: s });
  // 壊れた文字列は「IDだけの古い目印」と区別できないので、IDが違う扱いになる。
  // 古い形と同じく繋ぎ直し扱い（落とすだけで、消えはしない方向）
  assert.equal(r.suspicious, false);
});

// --- R12 ②: 「連携し直してください」の印を、重ね表示と同期で別々に持つ ---
//
// 印は重ね表示が読めた瞬間に消していた。同期（書き込み）側の権限切れで付けた印まで
// 同じ瞬間に消えると、案内が出てもすぐ消える。どちらで付いたかを持たせる。

t("何も無い状態から、重ね表示の権限切れで overlay、同期の権限切れで sync", () => {
  assert.equal(nextReconnectFlag(null, "overlay_reconnect"), "overlay");
  assert.equal(nextReconnectFlag(null, "sync_reconnect"), "sync");
  assert.equal(nextReconnectFlag("0", "sync_reconnect"), "sync");
});

t("両方で権限切れなら both。片方が直れば、もう片方だけ残る", () => {
  assert.equal(nextReconnectFlag("overlay", "sync_reconnect"), "both");
  assert.equal(nextReconnectFlag("sync", "overlay_reconnect"), "both");
  assert.equal(nextReconnectFlag("both", "overlay_ok"), "sync", "重ね表示が読めても、同期側の印は消さない");
  assert.equal(nextReconnectFlag("both", "sync_ok"), "overlay");
  assert.equal(nextReconnectFlag("sync", "overlay_ok"), "sync");
  assert.equal(nextReconnectFlag("overlay", "sync_ok"), "overlay");
  assert.equal(nextReconnectFlag("overlay", "overlay_ok"), "0");
  assert.equal(nextReconnectFlag("sync", "sync_ok"), "0");
});

t("修正前の印 \"1\" は、重ね表示で付いた印として扱う", () => {
  assert.equal(nextReconnectFlag("1", "overlay_ok"), "0");
  assert.equal(nextReconnectFlag("1", "sync_reconnect"), "both");
  assert.equal(reconnectBannerSource("1"), "overlay");
});

t("案内に出す種類：無し・重ね表示・同期・両方", () => {
  assert.equal(reconnectBannerSource(null), null);
  assert.equal(reconnectBannerSource("0"), null);
  assert.equal(reconnectBannerSource("overlay"), "overlay");
  assert.equal(reconnectBannerSource("sync"), "sync");
  assert.equal(reconnectBannerSource("both"), "both");
  assert.equal(reconnectBannerSource("なにか"), null, "知らない値で案内を出さない");
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
