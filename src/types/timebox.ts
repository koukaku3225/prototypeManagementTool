/**
 * タイムボックス — 時間帯を先に押さえる。
 *
 * Task（明日やる1件）や Habit（繰り返すもの）と違い、こちらは
 * 「何時から何時までを、これに使うと決めた」という予約である。
 *
 * 分けた理由: 実際に起きていた障害が「ご飯終わり、動画を見た流れで
 * 別のことを始めてしまう」という時間帯の奪われ方だった。
 * やることを決めても、時間を決めていないと他のものに埋まる。
 *
 * メタ認知の3項目（なぜ重要か / 何が障害か / 対策は）を枠自体に持たせるのは、
 * その場になってから考えるのでは間に合わないから。先に書いておいて、
 * 時間が来たら読むだけにする。
 */
export interface TimeBoxMeta {
  /** なぜそれが重要か */
  why: string;
  /** 何が障害か */
  obstacle: string;
  /** 対策は */
  counter: string;
}

/** 終わったあとの振り返り。完了時にだけ書く */
export interface TimeBoxReview {
  good: string;
  bad: string;
  next: string;
  /**
   * できばえ。0〜100。自分の中の最高の出来を100%としたときの相対評価で、
   * 絶対的な達成度ではない。任意なので未入力は null。
   * 既存データにはこのキー自体が無いので、読むときは ?? null を通すこと。
   */
  score: number | null;
}

export interface TimeBox {
  id: string;
  /** "2026-08-27"。必ずローカル日付（src/lib/date.ts） */
  date: string;
  /** "20:00"。24時間制 */
  start: string;
  /** "20:30"。start より後。日をまたぐ枠は作らない */
  end: string;
  title: string;
  /** どの目標のためか。単独の予定なら null */
  cardId: string | null;
  /**
   * 枠の色。null なら紐づけた目標から自動で決まる。
   * 目標ごとに色が付くと、1日の時間の使い方が形で分かる。
   * 手で変えたいときのために上書きも持たせてある。
   */
  color?: string | null;
  /**
   * どの習慣から生まれた枠か。手で作った枠は null。
   *
   * 習慣は曜日と開始時刻をすでに持っているので、時間割に自動で並べられる。
   * その「並べたもの」と「手で作ったもの」を見分けるために持つ。
   * 同じ習慣・同じ日の枠が二重に出ないよう、重複判定にも使う。
   */
  habitId?: string | null;
  meta: TimeBoxMeta;
  completedAt: string | null;
  /** 完了時にだけ入る。未完了なら null */
  review: TimeBoxReview | null;
  createdAt: string;
}

/**
 * いま進行中の打刻。
 *
 * 時間割は「先に決める」道具だが、計画しなかった日はアプリを開く理由が
 * なくなり、そのまま離れてしまう。こちらは逆向きで、
 * 始めるときに押して、終わったら止めるだけ。計画がゼロでも記録が残る。
 *
 * 同時に走らせられるのは1件。複数を並行して数えても、
 * あとで見たときにどれが実態か分からなくなる。
 */
export interface RunningEntry {
  title: string;
  cardId: string | null;
  /** 押した瞬間の時刻（ISO8601） */
  startedAt: string;
}

export const emptyMeta = (): TimeBoxMeta => ({
  why: "",
  obstacle: "",
  counter: "",
});

export const emptyReview = (): TimeBoxReview => ({
  good: "",
  bad: "",
  next: "",
  score: null,
});
