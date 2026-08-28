/**
 * タイムボックスの計算のテスト。
 *
 * 時刻の変換と重なりの詰め方は、間違っても画面上は「それらしく」見える。
 * 15分ずれた枠も、重なって隠れた枠も、気づくのは使っている最中になる。
 */
import assert from "node:assert/strict";
import {
  colorForCard,
  colorOf,
  currentBox,
  dragRange,
  duplicateSlot,
  moveBox,
  resizeBox,
  durationMin,
  humanDuration,
  layout,
  nextBox,
  normalizeRange,
  slotFromNow,
  overlaps,
  slotAt,
  snap,
  toMinutes,
  toTime,
  totalMinutes,
} from "../src/lib/timebox.ts";

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`✗ ${name}\n  ${e.message}\n`);
  }
}

const box = (id, start, end, over = {}) => ({
  id,
  date: "2026-08-27",
  start,
  end,
  title: id,
  cardId: null,
  meta: { why: "", obstacle: "", counter: "" },
  completedAt: null,
  review: null,
  createdAt: "2026-08-27T00:00:00.000Z",
  ...over,
});

// ---------------------------------------------------------------- 時刻の変換

t("時刻を分に直す", () => {
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("20:30"), 1230);
  assert.equal(toMinutes("23:59"), 1439);
  assert.equal(toMinutes("7:05"), 425, "1桁の時が読めていない");
});

t("壊れた時刻は null", () => {
  assert.equal(toMinutes("夜"), null);
  assert.equal(toMinutes("25:00"), null);
  assert.equal(toMinutes("24:30"), null);
  assert.equal(toMinutes("12:60"), null);
  assert.equal(toMinutes(""), null);
});

t("24:00 は読める。toTime(1440) が作る値なので", () => {
  assert.equal(toMinutes("24:00"), 1440);
  assert.equal(toMinutes(toTime(1440)), 1440, "作った値を読み戻せない");
});

t("24時に終わる枠の長さが正しく出る", () => {
  assert.equal(durationMin(box("a", "23:00", "24:00")), 60, "0分になっている");
});

t("24時に終わる枠も重なり判定に入る", () => {
  assert.equal(overlaps(box("a", "23:00", "24:00"), box("b", "23:30", "24:00")), true);
});

t("分を時刻に直す。ゼロ埋めする", () => {
  assert.equal(toTime(0), "00:00");
  assert.equal(toTime(425), "07:05");
  assert.equal(toTime(1230), "20:30");
});

t("1日を超えたら 24:00 で止める（日をまたがせない）", () => {
  assert.equal(toTime(1440), "24:00");
  assert.equal(toTime(2000), "24:00");
  assert.equal(toTime(-30), "00:00");
});

t("15分に丸める", () => {
  assert.equal(snap(0), 0);
  assert.equal(snap(7), 0);
  assert.equal(snap(8), 15);
  assert.equal(snap(22), 15);
  assert.equal(snap(23), 30);
  assert.equal(snap(1237), 1230);
});

// ---------------------------------------------------------------- 長さ

t("枠の長さ", () => {
  assert.equal(durationMin(box("a", "20:00", "20:30")), 30);
  assert.equal(durationMin(box("a", "09:00", "10:45")), 105);
});

t("壊れた時刻の枠は長さ0（落ちない）", () => {
  assert.equal(durationMin(box("a", "夜", "20:30")), 0);
  assert.equal(durationMin(box("a", "20:30", "20:00")), 0, "負にならないこと");
});

t("読める長さにする", () => {
  assert.equal(humanDuration(30), "30分");
  assert.equal(humanDuration(60), "1時間");
  assert.equal(humanDuration(90), "1時間30分");
  assert.equal(humanDuration(0), "0分");
});

// ---------------------------------------------------------------- 重なり

t("重なる枠を見分ける", () => {
  assert.equal(overlaps(box("a", "20:00", "21:00"), box("b", "20:30", "21:30")), true);
  assert.equal(overlaps(box("a", "20:00", "21:00"), box("b", "19:00", "22:00")), true);
});

t("接しているだけなら重ならない（20:30終わり／20:30始まり）", () => {
  assert.equal(overlaps(box("a", "20:00", "20:30"), box("b", "20:30", "21:00")), false);
});

t("離れていれば重ならない", () => {
  assert.equal(overlaps(box("a", "09:00", "10:00"), box("b", "11:00", "12:00")), false);
  assert.equal(overlaps(box("a", "11:00", "12:00"), box("b", "09:00", "10:00")), false);
});

t("壊れた時刻の枠は重ならない扱い（落ちない）", () => {
  assert.equal(overlaps(box("a", "夜", "10:00"), box("b", "09:00", "12:00")), false);
});

// ---------------------------------------------------------------- 配置

t("重なりがなければ全部1列", () => {
  const p = layout([box("a", "09:00", "10:00"), box("b", "11:00", "12:00")]);
  assert.equal(p.length, 2);
  assert.ok(p.every((x) => x.cols === 1 && x.col === 0));
});

t("位置は 開始分/1440", () => {
  const p = layout([box("a", "12:00", "13:00")]);
  assert.equal(p[0].top, 720 / 1440);
  assert.equal(p[0].height, 60 / 1440);
});

t("2件重なれば2列に分かれる", () => {
  const p = layout([box("a", "20:00", "21:00"), box("b", "20:30", "21:30")]);
  assert.equal(p.length, 2);
  assert.ok(p.every((x) => x.cols === 2), "列数が2になっていない");
  assert.deepEqual(p.map((x) => x.col).sort(), [0, 1], "同じ列に重ねている");
});

t("3件重なれば3列（各33%幅）", () => {
  const p = layout([
    box("a", "20:00", "21:00"),
    box("b", "20:15", "21:15"),
    box("c", "20:30", "21:30"),
  ]);
  assert.ok(p.every((x) => x.cols === 3));
  assert.deepEqual(p.map((x) => x.col).sort(), [0, 1, 2]);
});

t("重なりが途切れたら列数を数え直す", () => {
  const p = layout([
    box("a", "09:00", "10:00"),
    box("b", "09:30", "10:30"), // a と重なる → 2列
    box("c", "14:00", "15:00"), // 独立 → 1列
  ]);
  const byId = Object.fromEntries(p.map((x) => [x.box.id, x]));
  assert.equal(byId.a.cols, 2);
  assert.equal(byId.b.cols, 2);
  assert.equal(byId.c.cols, 1, "離れた枠まで細くなっている");
});

t("空いた列を使い回す", () => {
  // a が終わったあとの c は、a と同じ列に入れる
  const p = layout([
    box("a", "09:00", "10:00"),
    box("b", "09:00", "12:00"),
    box("c", "10:00", "11:00"),
  ]);
  const byId = Object.fromEntries(p.map((x) => [x.box.id, x]));
  assert.equal(byId.a.col, byId.c.col, "空いた列を使い回していない");
  assert.equal(byId.a.cols, 2, "3列に広がっている");
});

t("短い枠でも潰れない高さを持つ", () => {
  const p = layout([box("a", "20:00", "20:05")]);
  assert.ok(p[0].height >= 20 / 1440, "5分の枠が読めない高さになっている");
});

t("空でも落ちない", () => {
  assert.deepEqual(layout([]), []);
});

// ---------------------------------------------------------------- いま・次

t("進行中の枠を返す", () => {
  const boxes = [box("a", "20:00", "21:00"), box("b", "22:00", "23:00")];
  assert.equal(currentBox(boxes, 1230).id, "a"); // 20:30
});

t("始まる瞬間は進行中、終わる瞬間は進行中でない", () => {
  const boxes = [box("a", "20:00", "21:00")];
  assert.equal(currentBox(boxes, 1200)?.id, "a", "開始ちょうどが入っていない");
  assert.equal(currentBox(boxes, 1260), null, "終了ちょうどがまだ進行中になっている");
});

t("進行中がなければ null", () => {
  assert.equal(currentBox([box("a", "20:00", "21:00")], 600), null);
});

t("次に始まる枠を返す", () => {
  const boxes = [box("a", "20:00", "21:00"), box("b", "22:00", "23:00")];
  assert.equal(nextBox(boxes, 1260).id, "b"); // 21:00 の時点
});

t("指定時間内に始まるものだけに絞れる", () => {
  const boxes = [box("b", "22:00", "23:00")];
  assert.equal(nextBox(boxes, 1260, 30), null, "1時間先を30分以内としている");
  assert.equal(nextBox(boxes, 1290, 30).id, "b"); // 21:30 → 30分後
});

t("過ぎた枠は次にならない", () => {
  assert.equal(nextBox([box("a", "09:00", "10:00")], 1200), null);
});

// ---------------------------------------------------------------- 新規作成

t("タップした位置から15分刻みで枠を作る", () => {
  assert.deepEqual(slotAt(1237), { start: "20:30", end: "21:00" });
  assert.deepEqual(slotAt(0), { start: "00:00", end: "00:30" });
});

t("末尾でタップしても日をまたがない", () => {
  assert.deepEqual(slotAt(1439), { start: "23:30", end: "24:00" });
});

// ---------------------------------------------------------------- 正規化

t("終了が開始以前なら押し出す", () => {
  assert.deepEqual(normalizeRange("20:00", "19:00"), { start: "20:00", end: "20:15" });
  assert.deepEqual(normalizeRange("20:00", "20:00"), { start: "20:00", end: "20:15" });
});

t("正しい範囲はそのまま", () => {
  assert.deepEqual(normalizeRange("20:00", "21:30"), { start: "20:00", end: "21:30" });
});

t("壊れた終了時刻は既定の長さで補う", () => {
  assert.deepEqual(normalizeRange("20:00", "夜"), { start: "20:00", end: "20:30" });
});

// ---------------------------------------------------------------- 合計

t("その日の合計時間", () => {
  const boxes = [box("a", "09:00", "10:00"), box("b", "20:00", "20:30")];
  assert.equal(totalMinutes(boxes), 90);
});

t("完了ぶんだけ数えられる", () => {
  const boxes = [
    box("a", "09:00", "10:00", { completedAt: "2026-08-27T10:00:00.000Z" }),
    box("b", "20:00", "20:30"),
  ];
  assert.equal(totalMinutes(boxes, true), 60);
});

// ---------------------------------------------------------------- ドラッグで移動

t("動かしても長さは変わらない", () => {
  const r = moveBox(box("a", "20:00", "21:00"), 45);
  assert.deepEqual(r, { start: "20:45", end: "21:45" });
});

t("上へも動かせる", () => {
  assert.deepEqual(moveBox(box("a", "20:00", "21:00"), -90), {
    start: "18:30",
    end: "19:30",
  });
});

t("移動も15分に丸める", () => {
  assert.deepEqual(moveBox(box("a", "20:00", "20:30"), 7), {
    start: "20:00",
    end: "20:30",
  });
  assert.deepEqual(moveBox(box("a", "20:00", "20:30"), 8), {
    start: "20:15",
    end: "20:45",
  });
});

t("日の端で潰れず、長さを保ったまま押し戻す", () => {
  assert.deepEqual(moveBox(box("a", "23:00", "23:30"), 300), {
    start: "23:30",
    end: "24:00",
  });
  assert.deepEqual(moveBox(box("a", "00:30", "01:00"), -300), {
    start: "00:00",
    end: "00:30",
  });
});

// ---------------------------------------------------------------- 長さ変更

t("下端を引くと終わりだけ動く", () => {
  assert.deepEqual(resizeBox(box("a", "20:00", "21:00"), "end", 30), {
    start: "20:00",
    end: "21:30",
  });
});

t("上端を引くと始まりだけ動く", () => {
  assert.deepEqual(resizeBox(box("a", "20:00", "21:00"), "start", -30), {
    start: "19:30",
    end: "21:00",
  });
});

t("上を下げすぎても反転せず、最小の長さで止まる", () => {
  assert.deepEqual(resizeBox(box("a", "20:00", "21:00"), "start", 300), {
    start: "20:45",
    end: "21:00",
  });
});

t("下を上げすぎても反転せず、最小の長さで止まる", () => {
  assert.deepEqual(resizeBox(box("a", "20:00", "21:00"), "end", -300), {
    start: "20:00",
    end: "20:15",
  });
});

t("長さ変更は日の外へ出ない", () => {
  assert.deepEqual(resizeBox(box("a", "23:00", "23:30"), "end", 300), {
    start: "23:00",
    end: "24:00",
  });
  assert.deepEqual(resizeBox(box("a", "00:15", "01:00"), "start", -300), {
    start: "00:00",
    end: "01:00",
  });
});

// ---------------------------------------------------------------- 引いて作る

t("下に引くとその範囲になる", () => {
  assert.deepEqual(dragRange(20 * 60, 21 * 60), { start: "20:00", end: "21:00" });
});

t("上に引いても成立する", () => {
  assert.deepEqual(dragRange(21 * 60, 20 * 60), { start: "20:00", end: "21:00" });
});

t("ほとんど動かさなければ最小の長さになる", () => {
  assert.deepEqual(dragRange(20 * 60, 20 * 60 + 3), { start: "20:00", end: "20:15" });
});

t("引いて作る範囲も日をまたがない", () => {
  const r = dragRange(23 * 60 + 50, 25 * 60);
  assert.equal(r.end, "24:00");
  assert.ok(r.start < r.end);
});

// ---------------------------------------------------------------- 複製

t("複製は元の直後に置く", () => {
  assert.deepEqual(duplicateSlot(box("a", "20:00", "21:00")), {
    start: "21:00",
    end: "22:00",
  });
});

t("後ろに入らなければ前に置く", () => {
  const r = duplicateSlot(box("a", "23:00", "24:00"));
  assert.equal(r.end, "23:00");
  assert.equal(r.start, "22:00");
});

// ---------------------------------------------------------------- 色

t("同じ目標はいつも同じ色になる", () => {
  const a = colorForCard("card-abc");
  assert.equal(colorForCard("card-abc"), a);
});

t("紐づけない予定は鼠色", () => {
  assert.equal(colorForCard(null), "slate");
});

t("目標に付く色は鼠色にならない（区別がつかなくなる）", () => {
  for (const id of ["a", "b", "c", "card-1", "xyz-999"]) {
    assert.notEqual(colorForCard(id), "slate", id);
  }
});

t("手で決めた色が優先される", () => {
  assert.equal(colorOf({ color: "rose", cardId: "card-abc" }), "rose");
  assert.equal(colorOf({ color: null, cardId: "card-abc" }), colorForCard("card-abc"));
  assert.equal(colorOf({ color: "こわれた色", cardId: null }), "slate");
});

// ---------------------------------------------------------------- 現在時刻から

t("いまの時刻から始まる枠を作る（15分に切り下げる）", () => {
  // 10:07 なら 10:00 から。切り上げると、いま始めた作業が枠の外に出る
  assert.deepEqual(slotFromNow(10 * 60 + 7), { start: "10:00", end: "10:30" });
  assert.deepEqual(slotFromNow(10 * 60 + 14), { start: "10:00", end: "10:30" });
  assert.deepEqual(slotFromNow(10 * 60 + 15), { start: "10:15", end: "10:45" });
  assert.deepEqual(slotFromNow(0), { start: "00:00", end: "00:30" });
});

t("いまの時刻から始まる枠は日をまたがない", () => {
  assert.deepEqual(slotFromNow(23 * 60 + 50), { start: "23:30", end: "24:00" });
  assert.deepEqual(slotFromNow(1440), { start: "23:30", end: "24:00" });
});

t("いまの時刻から始まる枠は長さを指定できる", () => {
  assert.deepEqual(slotFromNow(9 * 60, 90), { start: "09:00", end: "10:30" });
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
