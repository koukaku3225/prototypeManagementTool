/**
 * 日付ヘルパーのテスト。
 *
 * ここは目で見ても間違いに気づけない類のコードで、しかも間違うと
 * 「今日やること」が深夜に消える・ストリークが理不尽に切れる、という
 * 再現しづらい形で表面化する。実行は `npm test`。
 */
import assert from "node:assert/strict";
import {
  addDays,
  diffDays,
  dueLabel,
  isDueBy,
  isOverdue,
  isThisWeek,
  normalizeTime,
  startOfWeek,
  toLocalDate,
} from "../src/lib/date.ts";

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

// ---------------------------------------------------------------- toLocalDate

t("toLocalDate はローカルの暦日を返す", () => {
  // ローカル時刻で明示的に作る。UTC 変換を挟まない
  assert.equal(toLocalDate(new Date(2026, 7, 26, 0, 5)), "2026-08-26");
  assert.equal(toLocalDate(new Date(2026, 7, 26, 23, 55)), "2026-08-26");
});

t("toLocalDate はゼロ埋めする", () => {
  assert.equal(toLocalDate(new Date(2026, 0, 3)), "2026-01-03");
});

t("深夜0時台でも前日にならない（UTC実装だとJSTで9時間ズレる）", () => {
  // toISOString() を使っていたら "2026-08-25" になる時刻
  const midnightJst = new Date(2026, 7, 26, 0, 30);
  assert.equal(toLocalDate(midnightJst), "2026-08-26");
});

// ---------------------------------------------------------------- addDays

t("addDays は月をまたぐ", () => {
  assert.equal(addDays(1, new Date(2026, 7, 31)), "2026-09-01");
  assert.equal(addDays(-1, new Date(2026, 8, 1)), "2026-08-31");
});

t("addDays は年をまたぐ", () => {
  assert.equal(addDays(1, new Date(2026, 11, 31)), "2027-01-01");
});

t("addDays は閏日を正しく扱う", () => {
  assert.equal(addDays(1, new Date(2028, 1, 28)), "2028-02-29");
  assert.equal(addDays(1, new Date(2026, 1, 28)), "2026-03-01");
});

// ---------------------------------------------------------------- 期限判定

t("isDueBy: 今日と過去は true、未来は false", () => {
  const today = toLocalDate(new Date());
  assert.equal(isDueBy(today), true);
  assert.equal(isDueBy(addDays(-1)), true);
  assert.equal(isDueBy(addDays(1)), false);
});

t("isOverdue: 今日は遅れではない", () => {
  assert.equal(isOverdue(toLocalDate(new Date())), false);
  assert.equal(isOverdue(addDays(-1)), true);
  assert.equal(isOverdue(addDays(1)), false);
});

t("空文字は期限なし扱い（未設定のタスクを今日に混ぜない）", () => {
  assert.equal(isDueBy(""), false);
  assert.equal(isOverdue(""), false);
  assert.equal(dueLabel(""), "期限なし");
});

// ---------------------------------------------------------------- dueLabel

t("dueLabel は今日・明日を言葉にする", () => {
  assert.equal(dueLabel(toLocalDate(new Date())), "今日");
  assert.equal(dueLabel(addDays(1)), "明日");
});

t("dueLabel は遅れを日数で言う", () => {
  assert.equal(dueLabel(addDays(-1)), "1日遅れ");
  assert.equal(dueLabel(addDays(-3)), "3日遅れ");
});

t("dueLabel は先の予定は日付のまま出す", () => {
  assert.equal(dueLabel(addDays(5)), addDays(5));
});

// ---------------------------------------------------------------- diffDays

t("diffDays は月またぎでも正しい", () => {
  assert.equal(diffDays("2026-08-31", "2026-09-01"), 1);
  assert.equal(diffDays("2026-08-24", "2026-08-26"), 2);
  assert.equal(diffDays("2026-08-26", "2026-08-26"), 0);
});

// ---------------------------------------------------------------- normalizeTime

t("normalizeTime は妥当な時刻をゼロ埋めして返す", () => {
  assert.equal(normalizeTime("7:30"), "07:30");
  assert.equal(normalizeTime("21:00"), "21:00");
  assert.equal(normalizeTime("00:00"), "00:00");
  assert.equal(normalizeTime("23:59"), "23:59");
});

t("normalizeTime は全角コロンも受ける", () => {
  assert.equal(normalizeTime("21：00"), "21:00");
});

t("normalizeTime は前後の空白を無視する", () => {
  assert.equal(normalizeTime(" 07:30 "), "07:30");
});

t("normalizeTime は曖昧な言い方を受け付けない（嘘の時刻を保存しない）", () => {
  assert.equal(normalizeTime("夜"), null);
  assert.equal(normalizeTime("時間があるとき"), null);
  assert.equal(normalizeTime("夜9時"), null);
  assert.equal(normalizeTime("9時ごろ"), null);
});

t("normalizeTime は範囲外を弾く", () => {
  assert.equal(normalizeTime("24:00"), null);
  assert.equal(normalizeTime("12:60"), null);
  assert.equal(normalizeTime("99:99"), null);
});

t("normalizeTime は未設定を null にする", () => {
  assert.equal(normalizeTime(null), null);
  assert.equal(normalizeTime(undefined), null);
  assert.equal(normalizeTime(""), null);
});

// ---------------------------------------------------------------- 週

t("startOfWeek はその週の月曜を返す", () => {
  // 2026-09-01 は火曜。週の頭は 08-31（月）
  assert.equal(startOfWeek(new Date("2026-09-01T10:00:00")), "2026-08-31");
  // 月曜そのものは動かさない
  assert.equal(startOfWeek(new Date("2026-08-31T00:00:00")), "2026-08-31");
  // 土曜も同じ週
  assert.equal(startOfWeek(new Date("2026-09-05T23:59:00")), "2026-08-31");
});

t("startOfWeek の日曜は「前の月曜」まで戻る（週の終わりであって始まりではない）", () => {
  // 2026-09-06 は日曜。日曜始まりにすると土日が2週に割れて読めなくなる
  assert.equal(startOfWeek(new Date("2026-09-06T12:00:00")), "2026-08-31");
});

t("startOfWeek は月をまたいでも正しい", () => {
  // 2026-03-01 は日曜 → 前の月曜は 02-23
  assert.equal(startOfWeek(new Date("2026-03-01T12:00:00")), "2026-02-23");
});

t("isThisWeek は月曜から日曜までを含む", () => {
  const tue = new Date("2026-09-01T10:00:00");
  assert.equal(isThisWeek("2026-08-31", tue), true, "週初の月曜");
  assert.equal(isThisWeek("2026-09-01", tue), true, "当日");
  assert.equal(isThisWeek("2026-09-06", tue), true, "週末の日曜");
  assert.equal(isThisWeek("2026-08-30", tue), false, "前週の日曜");
  assert.equal(isThisWeek("2026-09-07", tue), false, "翌週の月曜");
});

t("isThisWeek は空文字を false にする（期限なしを今週に数えない）", () => {
  assert.equal(isThisWeek("", new Date("2026-09-01T10:00:00")), false);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
