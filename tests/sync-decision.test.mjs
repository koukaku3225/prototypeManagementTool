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

t("【不変条件】別アカウントとして同期されていたローカルは、自動で送らない（指摘2）", () => {
  // 共有ブラウザで A → B に切り替えたとき、A のデータを B に黙って送らない
  for (const cloudHasContent of [true, false]) {
    const d = decideSyncDirection({
      alreadySynced: false,
      localHasContent: true,
      cloudHasContent,
      localOwnedByOtherUser: true,
    });
    assert.equal(d, "conflict");
  }
});

t("別アカウントの記録があっても、ローカルが空なら今までどおり", () => {
  assert.equal(
    decideSyncDirection({ alreadySynced: false, localHasContent: false, cloudHasContent: true, localOwnedByOtherUser: true }),
    "pull",
  );
  assert.equal(
    decideSyncDirection({ alreadySynced: false, localHasContent: false, cloudHasContent: false, localOwnedByOtherUser: true }),
    "ready",
  );
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

// ---- 取り込み（pull）で、クラウドに乗っていないキーを持ち越す ----
//
// gc.checkpoints（中間目標と建て方の評価）は Supabase にテーブルが無い。
// restoreState() は対象キーを一度すべて消すので、持ち越さないと
// 「置き換える」を押した瞬間に中間目標が黙って全部消えていた。

const { carryOverOnPull } = await import("../src/lib/supabase/sync-decision.ts");

const cp = (id, cardId) => ({ id, cardId, kind: "week", title: id });

t("端末固有キー（打刻・A/B・版番号）はそのまま持ち越す", () => {
  const out = carryOverOnPull(
    { "gc.running": '{"startedAt":"x"}', "gc.variant": '"a"', "gc.schemaVersion": "3", "gc.cards": "[]" },
    [],
  );
  assert.deepEqual(out, { "gc.running": '{"startedAt":"x"}', "gc.variant": '"a"', "gc.schemaVersion": "3" });
});

t("中間目標は、取り込んだ目標にぶら下がるものだけ持ち越す", () => {
  const out = carryOverOnPull(
    { "gc.checkpoints": JSON.stringify([cp("c1", "A"), cp("c2", "B"), cp("c3", "A")]) },
    ["A"],
  );
  assert.deepEqual(JSON.parse(out["gc.checkpoints"]), [cp("c1", "A"), cp("c3", "A")]);
});

t("持ち越す中間目標が1件も無ければ、キーを置かない", () => {
  assert.deepEqual(carryOverOnPull({ "gc.checkpoints": JSON.stringify([cp("c1", "B")]) }, ["A"]), {});
  assert.deepEqual(carryOverOnPull({}, ["A"]), {});
});

t("中間目標のJSONが壊れていても落ちず、持ち越さない", () => {
  assert.deepEqual(carryOverOnPull({ "gc.checkpoints": "{壊れた" }, ["A"]), {});
  assert.deepEqual(carryOverOnPull({ "gc.checkpoints": '{"not":"array"}' }, ["A"]), {});
});

// ---- 中間目標のクラウド同期、端末ごとに初回だけ合わせる（R16） ----

const { mergeCheckpoints, sendableCheckpoint } = await import("../src/lib/supabase/sync-decision.ts");

const U1 = "0b0f2a4e-1111-4a4a-8a8a-000000000001";
const U2 = "0b0f2a4e-1111-4a4a-8a8a-000000000002";
const U3 = "0b0f2a4e-1111-4a4a-8a8a-000000000003";
const CARD = "f5d40667-55fb-4084-9fbb-df21a03b3df2";
const full = (id, updatedAt, over = {}) => ({
  id,
  cardId: CARD,
  title: id.slice(-1),
  period: { kind: "week", start: "2026-09-14", end: "2026-09-20" },
  status: "active",
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt,
  ...over,
});

t("ローカルだけ・クラウドだけの中間目標は、両方残す（初回に片方を消さない）", () => {
  const out = mergeCheckpoints([full(U1, "2026-09-14T01:00:00Z")], [full(U2, "2026-09-14T01:00:00Z")]);
  assert.deepEqual(out.map((c) => c.id).sort(), [U1, U2]);
});

t("同じ中間目標が両方にあれば、更新が新しいほうを採る", () => {
  const local = full(U1, "2026-09-14T05:00:00Z", { title: "ローカルで直した" });
  const cloud = full(U1, "2026-09-14T03:00:00Z", { title: "古い" });
  assert.equal(mergeCheckpoints([local], [cloud])[0].title, "ローカルで直した");
  const newerCloud = full(U1, "2026-09-14T09:00:00Z", { title: "別端末で直した" });
  assert.equal(mergeCheckpoints([local], [newerCloud])[0].title, "別端末で直した");
});

t("更新時刻が同じならローカルを採る（いま見ている画面と食い違わせない）", () => {
  const local = full(U1, "2026-09-14T05:00:00Z", { title: "ローカル" });
  const cloud = full(U1, "2026-09-14T05:00:00Z", { title: "クラウド" });
  const out = mergeCheckpoints([local], [cloud]);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "ローカル");
});

t("両方空なら空", () => {
  assert.deepEqual(mergeCheckpoints([], []), []);
});

t("送れる中間目標：id・目標ID が uuid、日付が YYYY-MM-DD、種類と状態が決まった値", () => {
  assert.equal(sendableCheckpoint(full(U3, "2026-09-14T00:00:00Z")), true);
  assert.equal(sendableCheckpoint(full("not-a-uuid", "x")), false);
  assert.equal(sendableCheckpoint(full(U3, "x", { cardId: "card-1" })), false);
  assert.equal(sendableCheckpoint(full(U3, "x", { period: { kind: "week", start: "来週", end: "2026-09-20" } })), false);
  assert.equal(sendableCheckpoint(full(U3, "x", { period: { kind: "day", start: "2026-09-14", end: "2026-09-20" } })), false);
  assert.equal(sendableCheckpoint(full(U3, "x", { status: "paused" })), false);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
