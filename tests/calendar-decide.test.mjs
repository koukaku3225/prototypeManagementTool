/**
 * 同期の判断を組み合わせで総当たりする。
 *
 * クラウド同期で「表の2マスしか実装していない」ことに気づけず、
 * 本番でデータが出てこない・消えかける、という2つの事故を出した。
 * 判断をI/Oから切り離してあるので、ここで全パターンを固定できる。
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
    boxHasNotes: false,
    boxUpdatedAt: null,
    eventState: "missing",
    eventHasMark: false,
    eventUpdated: null,
    contentEqual: false,
    ...over,
  };
}

t("#1 アプリにあり、カレンダーに無い → カレンダーに作る", () => {
  assert.equal(
    decideCalendarAction(inputs({ boxExists: true, eventState: "missing" })),
    "createEvent",
  );
});

t("#2a 両方あり、アプリ側が新しい → カレンダーを更新", () => {
  assert.equal(
    decideCalendarAction(
      inputs({
        boxExists: true,
        eventState: "present",
        eventHasMark: true,
        boxUpdatedAt: "2026-09-05T10:00:00.000Z",
        eventUpdated: "2026-09-05T09:00:00.000Z",
      }),
    ),
    "updateEvent",
  );
});

t("#2b 両方あり、カレンダー側が新しい → アプリを更新", () => {
  assert.equal(
    decideCalendarAction(
      inputs({
        boxExists: true,
        eventState: "present",
        eventHasMark: true,
        boxUpdatedAt: "2026-09-05T09:00:00.000Z",
        eventUpdated: "2026-09-05T10:00:00.000Z",
      }),
    ),
    "updateBox",
  );
});

t("#2c 両方あり、中身が同じ → 何もしない", () => {
  assert.equal(
    decideCalendarAction(
      inputs({
        boxExists: true,
        eventState: "present",
        eventHasMark: true,
        contentEqual: true,
        boxUpdatedAt: "2026-09-05T09:00:00.000Z",
        eventUpdated: "2026-09-05T10:00:00.000Z",
      }),
    ),
    "none",
  );
});

t("#2d 同点ならアプリ側を優先する", () => {
  // アプリ側の変更は必ず意図的な操作。カレンダーの updated は他の要因でも動く
  assert.equal(
    decideCalendarAction(
      inputs({
        boxExists: true,
        eventState: "present",
        eventHasMark: true,
        boxUpdatedAt: "2026-09-05T10:00:00.000Z",
        eventUpdated: "2026-09-05T10:00:00.000Z",
      }),
    ),
    "updateEvent",
  );
});

t("#3a カレンダーで削除され、書き込みが無い → アプリからも消す", () => {
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: true, eventState: "cancelled", boxHasNotes: false }),
    ),
    "deleteBox",
  );
});

t("#3b カレンダーで削除されたが、振り返り等がある → 残す", () => {
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: true, eventState: "cancelled", boxHasNotes: true }),
    ),
    "keepBox",
  );
});

t("#4 アプリに無く、印のある予定 → アプリで消された。カレンダーからも消す", () => {
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: false, eventState: "present", eventHasMark: true }),
    ),
    "deleteEvent",
  );
});

t("#5 アプリに無く、印の無い予定 → カレンダーで作られた。取り込む", () => {
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: false, eventState: "present", eventHasMark: false }),
    ),
    "importBox",
  );
});

t("#6 アプリに無く、カレンダーでも削除済み → 何もしない", () => {
  assert.equal(
    decideCalendarAction(inputs({ boxExists: false, eventState: "cancelled" })),
    "none",
  );
});

t("#7 習慣由来の枠は同期しない", () => {
  // 実体を持たず毎回作り直されるので、書くと削除が走り続ける
  assert.equal(
    decideCalendarAction(
      inputs({ boxExists: true, boxIsGhost: true, eventState: "missing" }),
    ),
    "none",
  );
});

t("【不変条件1】書き込みのある枠を、決して消さない", () => {
  for (const eventState of ["missing", "present", "cancelled"]) {
    for (const eventHasMark of [true, false]) {
      const d = decideCalendarAction(
        inputs({ boxExists: true, boxHasNotes: true, eventState, eventHasMark }),
      );
      assert.notEqual(d, "deleteBox", `${eventState}/${eventHasMark} で deleteBox`);
    }
  }
});

t("【不変条件2】印の無い予定を、決して削除しない", () => {
  // 印が無い ＝ カレンダー側で人が作ったもの。うちが消してよいものではない
  for (const boxExists of [true, false]) {
    const d = decideCalendarAction(
      inputs({ boxExists, eventState: "present", eventHasMark: false }),
    );
    assert.notEqual(d, "deleteEvent", `boxExists=${boxExists} で deleteEvent`);
  }
});

t("【不変条件3】習慣由来の枠は、どの組み合わせでも none", () => {
  for (const eventState of ["missing", "present", "cancelled"]) {
    for (const boxHasNotes of [true, false]) {
      assert.equal(
        decideCalendarAction(
          inputs({ boxExists: true, boxIsGhost: true, eventState, boxHasNotes }),
        ),
        "none",
      );
    }
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
