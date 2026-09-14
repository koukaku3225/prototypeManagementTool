/**
 * 専用カレンダーへの書き込みの判断を、組み合わせで総当たりする。
 *
 * 2026-09-14 から専用カレンダーは「アプリ → Google」の一方向になった。
 * 取り込みは本人のメインカレンダーから別経路（primary.ts）で行う。
 * 専用カレンダーから取り込んでいた頃、印の無い予定が二重になる・
 * アプリで消しても復活する、という不具合が本番で出た（実機検証の報告を参照）。
 * 実行は `npm test`。
 */
import assert from "node:assert/strict";
import { decideCalendarAction } from "../src/lib/calendar/decide.ts";

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

/** 既定値。各テストは必要な軸だけ上書きする */
function inputs(over) {
  return {
    boxExists: false,
    boxIsGhost: false,
    eventState: "missing",
    eventHasMark: false,
    contentEqual: false,
    ...over,
  };
}

const STATES = ["missing", "present", "cancelled"];

t("#1 アプリにあり、カレンダーに無い → 作る", () => {
  assert.equal(decideCalendarAction(inputs({ boxExists: true })), "createEvent");
});

t("#2a 両方あり、中身が違う → アプリの内容でカレンダーを直す", () => {
  assert.equal(
    decideCalendarAction(inputs({ boxExists: true, eventState: "present", eventHasMark: true })),
    "updateEvent",
  );
});

t("#2b 両方あり、中身も印も同じ → 何もしない", () => {
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: true, eventState: "present", eventHasMark: true, contentEqual: true }),
    ),
    "none",
  );
});

t("#2c 中身は同じだが印が無い（旧取り込み分）→ 印を付けるために直す", () => {
  // 印が無いまま残すと、アプリで消したときに Google 側を片付けられない
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: true, eventState: "present", eventHasMark: false, contentEqual: true }),
    ),
    "updateEvent",
  );
});

t("#3 カレンダーで消された → アプリが正なので作り直す（アプリからは消さない）", () => {
  assert.equal(
    decideCalendarAction(inputs({ boxExists: true, eventState: "cancelled" })),
    "createEvent",
  );
});

t("#4 アプリに無く、印のある予定 → アプリで消された。カレンダーからも消す", () => {
  assert.equal(
    decideCalendarAction(inputs({ eventState: "present", eventHasMark: true })),
    "deleteEvent",
  );
});

t("#5 アプリに無く、印の無い予定 → 触らない（取り込みもしない）", () => {
  assert.equal(decideCalendarAction(inputs({ eventState: "present" })), "none");
});

t("#6 アプリに無く、カレンダーでも削除済み → 何もしない", () => {
  assert.equal(
    decideCalendarAction(inputs({ eventState: "cancelled", eventHasMark: true })),
    "none",
  );
});

t("#7 習慣由来の枠は同期しない", () => {
  for (const eventState of STATES) {
    for (const eventHasMark of [true, false]) {
      assert.equal(
        decideCalendarAction(inputs({ boxExists: true, boxIsGhost: true, eventState, eventHasMark })),
        "none",
      );
    }
  }
});

t("【不変条件】専用カレンダーを根拠にアプリの枠を書き換えたり消したりしない", () => {
  for (const boxExists of [true, false]) {
    for (const eventState of STATES) {
      for (const eventHasMark of [true, false]) {
        for (const contentEqual of [true, false]) {
          const d = decideCalendarAction(
            inputs({ boxExists, eventState, eventHasMark, contentEqual }),
          );
          assert.ok(
            ["createEvent", "updateEvent", "deleteEvent", "none"].includes(d),
            `${boxExists}/${eventState}/${eventHasMark}/${contentEqual} で ${d}`,
          );
        }
      }
    }
  }
});

t("【不変条件】印の無い予定を、決して削除しない", () => {
  for (const boxExists of [true, false]) {
    for (const eventState of STATES) {
      const d = decideCalendarAction(inputs({ boxExists, eventState, eventHasMark: false }));
      assert.notEqual(d, "deleteEvent", `boxExists=${boxExists}/${eventState} で deleteEvent`);
    }
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
