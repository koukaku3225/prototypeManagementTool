/**
 * 同期の向きの決め方を、組み合わせで総当たりする。
 *
 * この表を埋めていなかったことが、実際に2つの不具合を生んだ。
 *   1. 「ローカル空・クラウドに中身」を実装しておらず、
 *      本番でローカルの内容が一切出てこなかった
 *   2. 「突合済・ローカル空・クラウドに中身」で送信を繋いでしまい、
 *      すべて消してやり直したあとにクラウドの実データが消えうる状態だった
 *
 * どちらも型でもテストでも捕まらず、実際に使うまで気づけなかった。
 * 入力は3つの真偽値しかないので、全部（2^3 = 8通り）を明示的に固定する。
 * 実行は `npm test`。
 */
import assert from "node:assert/strict";
import { decideSyncDirection, isForeignKeyViolation } from "../src/lib/supabase/sync-decision.ts";

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
 * 8通りすべての期待値。1行も欠かさないこと。
 * 新しい状態を足すなら、この表を先に埋めてから実装する。
 */
const TABLE = [
  // 突合済, ローカル, クラウド, 期待, 何が起きている状況か
  [false, false, false, "ready", "新しい端末・クラウドも空。初めて使う人"],
  [false, false, true, "pull", "新しい端末で、既存アカウントにログインした"],
  [false, true, false, "push", "ずっとログインせず使っていた端末が、初めてログインした"],
  [false, true, true, "conflict", "別々に育った端末とクラウドが初めて出会った"],
  [true, false, false, "ready", "突合済みで、両方とも空"],
  [true, false, true, "conflict", "すべて消してやり直した／サイトデータが消えた"],
  [true, true, false, "push", "突合済み。クラウド側が空になった"],
  [true, true, true, "push", "いつもの状態。ふつうに送る"],
];

for (const [alreadySynced, localHasContent, cloudHasContent, expected, note] of TABLE) {
  t(`突合${alreadySynced ? "済" : "前"} / ローカル${localHasContent ? "有" : "空"} / クラウド${cloudHasContent ? "有" : "空"} → ${expected}（${note}）`, () => {
    assert.equal(
      decideSyncDirection({ alreadySynced, localHasContent, cloudHasContent }),
      expected,
    );
  });
}

t("表が8通りすべてを網羅している", () => {
  assert.equal(TABLE.length, 8, "2^3 = 8 通り。抜けがあると、その状態は誰も試していない");
  const seen = new Set(TABLE.map(([a, b, c]) => `${a}${b}${c}`));
  assert.equal(seen.size, 8, "同じ組み合わせが重複している");
});

/*
 * 不変条件。表の中身とは別に、これだけは何があっても破ってはならない。
 * 「ローカルが空なのにクラウドへ送る」は、送信側の突き合わせが
 * 「ローカルに無いものは消す」である以上、必ずデータ消失になる。
 */
t("【不変条件】ローカルが空・クラウドに中身があるとき、絶対に push を返さない", () => {
  for (const alreadySynced of [true, false]) {
    const d = decideSyncDirection({
      alreadySynced,
      localHasContent: false,
      cloudHasContent: true,
    });
    assert.notEqual(
      d,
      "push",
      `突合${alreadySynced ? "済" : "前"}で push を返した。これはクラウドのデータを消す`,
    );
  }
});

t("【不変条件】pull を返すのは、ローカルが空のときだけ", () => {
  // pull はローカルを上書きする。中身があるときにやれば、それは消失になる
  for (const alreadySynced of [true, false]) {
    for (const cloudHasContent of [true, false]) {
      const d = decideSyncDirection({
        alreadySynced,
        localHasContent: true,
        cloudHasContent,
      });
      assert.notEqual(d, "pull", "中身のあるローカルを上書きしようとしている");
    }
  }
});

// ---- 外部キー違反の判定。これを取り違えると自己修復が走らない ----

t("Postgres のコード 23503 を外部キー違反と判定する", () => {
  assert.equal(isForeignKeyViolation({ code: "23503" }), true);
});

t("コードが無くても文言で拾う", () => {
  // Supabase の経路によっては code が落ちることがある
  assert.equal(
    isForeignKeyViolation({
      message: 'violates foreign key constraint "timeboxes_habit_id_fkey"',
    }),
    true,
  );
});

t("関係のないエラーを外部キー違反と誤判定しない", () => {
  // 誤判定すると、直らない失敗のたびに全件送信を繰り返すことになる
  assert.equal(isForeignKeyViolation({ code: "22P02", message: "invalid input syntax for type uuid" }), false);
  assert.equal(isForeignKeyViolation(new Error("network error")), false);
  assert.equal(isForeignKeyViolation(null), false);
  assert.equal(isForeignKeyViolation("23503"), false);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
