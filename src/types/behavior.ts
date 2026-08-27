/**
 * 続けるための型。
 *
 * goal.ts（決めるための型）とは別ファイルにしてある。goal.ts はすでに
 * フェーズ定数・成果物・対話・計測が同居していて肥大しているのと、
 * こちらは「毎日書き換わるもの」で寿命がまったく違うため。
 *
 * ■ 絶対にやってはいけないこと
 * GoalCard の中に habits[] や logs[] を埋め込むこと。
 * upsertCard() はカード全体を丸ごと置換するので、目標編集画面を開いていた
 * 古い state で保存した瞬間に、その日の記録が消える。必ず別キーで持つ。
 */

/** 繰り返しの型。曜日は 0=日 … 6=土 */
export type HabitSchedule =
  | { kind: "daily" }
  | { kind: "weekdays"; days: number[] }
  /** 「週3回、曜日は問わない」。予定日という概念を持たない */
  | { kind: "timesPerWeek"; times: number };

/**
 * 繰り返す行動。単発の Task と対になる概念。
 *
 * Task は「明日やる1件」、Habit は「毎週◯回やり続けるもの」。
 * どちらも GoalCard にぶら下がる。
 */
export interface Habit {
  id: string;
  /** どの目標のためか。孤児の習慣は作らない */
  cardId: string;
  title: string;
  /**
   * 「これだけならできる」最小版。
   * 無理な日にゼロにするより、最小版でも続けたほうが途切れない。
   * 空文字なら未設定（3択の「最小版」を出さない）。
   */
  minimalTitle: string;
  estimateMin: number;
  schedule: HabitSchedule;
  /** "21:00"。実行意図の「いつ」。Task と同じ扱い */
  startTime: string | null;
  /** 「自室の机」。実行意図の「どこで」 */
  where: string | null;
  /** 「朝コーヒーを淹れたら」。既存の習慣に紐づける（習慣スタッキング） */
  cue: string | null;
  createdAt: string;
  /**
   * やめた習慣。消さずに畳む。
   * 「続かなかった」も記録で、消すと同じ失敗を繰り返したことに気づけない。
   */
  archivedAt: string | null;
}

/**
 * 実施の状態。
 *
 * done / missed の2値にしないのは、「できなかった」と「今日は予定外」を
 * 同じ扱いにすると達成率が理不尽に下がるため。
 * - done    … やった
 * - partial … 最小版だけやった。途切れとは数えない
 * - skipped … 今日はやらないと決めた（体調・予定）。分母から外す
 * - missed  … 予定していたのにできなかった
 */
export type HabitLogState = "done" | "partial" | "skipped" | "missed";

/**
 * 1日1件の実施記録。
 *
 * チェックを外しても行は消えない（state が変わるだけ）。
 * 「completedAt を null に戻すと記録そのものが消える」という
 * Task 側の壊れ方を、ここでは繰り返さない。
 */
export interface HabitLog {
  habitId: string;
  /** "2026-08-27"。必ずローカル日付（src/lib/date.ts） */
  date: string;
  state: HabitLogState;
  /** 実際に押した時刻 */
  at: string;
  /** 一言メモ。任意。必須にするとチェック率そのものが落ちる */
  note: string | null;
  /** 気分 1〜5。任意 */
  mood: 1 | 2 | 3 | 4 | 5 | null;
}

/** 表示用にまとめた集計。導出値なので保存しない */
export interface HabitStats {
  /** 直近30日の達成率（0〜1）。分母は予定日から skipped を除いたもの */
  rate30: number;
  /** 集計に使った予定日数。少ないうちは率を出しても意味がない */
  scheduled30: number;
  /** 連続。予定日ベースで数える。partial は途切れとしない */
  streak: number;
  /** 保険の残り。直近7日で1回まで、途切れを無かったことにする */
  freezeLeft: number;
  /** 今日は予定日か */
  dueToday: boolean;
  /** 今日の記録。無ければ null */
  todayLog: HabitLog | null;
}
