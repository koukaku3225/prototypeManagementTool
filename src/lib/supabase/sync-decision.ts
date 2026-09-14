/**
 * 同期の向きを決める判断だけを、外部依存なしで切り出したもの。
 *
 * ここを Supabase 呼び出しと混ぜていたせいで、組み合わせを全部試すことが
 * できず、表の2マスしか実装していないことに誰も気づかなかった
 * （「本番でローカルの内容が出てこない」の正体）。
 * 純粋関数にしてあるので、tests/sync-decision.test.mjs が全通り総当たりできる。
 */

import { DEVICE_LOCAL_KEYS, KEY } from "@/lib/storage-keys";
import { isValidUuid } from "@/lib/uuid";
import type { Checkpoint } from "@/types/goal";

export type SyncDirection =
  /** クラウドを正として、この端末を上書きする */
  | "pull"
  /** この端末を正として、クラウドへ送る */
  | "push"
  /**
   * クラウドとこの端末を合体（mergeSnapshots）してから、両方をその結果にそろえる。
   * 突合済みの端末で、両方に中身があるとき。
   */
  | "merge"
  /** どちらが正か決められない。本人に選ばせる。この間 push は繋がない */
  | "conflict"
  /** どちらにも中身が無い。そのまま繋いでよい */
  | "ready";

export interface SyncInputs {
  /** この端末が、このユーザーとして一度クラウドと突き合わせ済みか */
  alreadySynced: boolean;
  /** この端末に、ユーザーの成果物が1つでもあるか */
  localHasContent: boolean;
  /** クラウド側に、このユーザーの成果物が1つでもあるか */
  cloudHasContent: boolean;
  /**
   * この端末のデータが、別のアカウントとして同期されていたものか。
   * 省略は false（突き合わせの記録が無い＝ログイン前に作ったデータ）。
   */
  localOwnedByOtherUser?: boolean;
}

/**
 * 守る不変条件は1つだけ。
 *
 *   **「空」を自動で伝播させない。**
 *
 * 送信側の突き合わせは「ローカルに無いものはクラウドからも消す」なので、
 * 空のローカルを根拠に push を繋いだ瞬間、クラウドの実データが消える。
 * よって「ローカルが空・クラウドに中身あり」で push を返すことは、
 * どんな状況でもあってはならない。
 *
 * この関数が返す向きと、実際の8通りの対応は次のとおり。
 *
 * | 突合済 | ローカル | クラウド | 返り値   | 理由 |
 * |--------|----------|----------|----------|------|
 * | -      | 空       | 中身あり | pull/conflict | 空を送らない。初回なら取り込む、そうでなければ聞く |
 * | false  | 中身あり | 中身あり | conflict | どちらが新しいか決められない |
 * | false  | 中身あり | 空       | push     | クラウドが空なので消すものが無い |
 * | false  | 空       | 空       | ready    | 何も起きない |
 * | true   | 中身あり | *        | push     | 突合済みなので、いつもどおり送る |
 * | true   | 空       | 空       | ready    | 何も起きない |
 */
export function decideSyncDirection(i: SyncInputs): SyncDirection {
  // 1. 空を送らない。これが最優先で、他のどの条件よりも先に効く
  if (!i.localHasContent && i.cloudHasContent) {
    /*
     * 突き合わせ前（＝新しい端末）なら、取り込むのが明らかに正しい。
     *
     * 突き合わせ済みなのにローカルだけ空になったのは、
     * 「すべて消してやり直す」を押した・サイトデータが消えた等で、
     * 本人の意図なのか事故なのかを機械的に区別できない。
     * 勝手に消さず、勝手に戻しもせず、聞く。
     */
    return i.alreadySynced ? "conflict" : "pull";
  }

  /*
   * 1.5 別のアカウントのデータを、本人の同意なしに新しいアカウントへ送らない。
   *
   * 共有のブラウザで A がログアウトし B がログインすると、A のデータが
   * localStorage に残ったまま「未突合・ローカルあり・クラウド空」になり、
   * 以前は push で B の保存対象になっていた（セキュリティレビュー指摘2）。
   * 引き継ぐか取り込むかは、B に選ばせる。
   */
  if (i.localHasContent && i.localOwnedByOtherUser) return "conflict";

  // 2. クラウドが空なら、送っても失われるものが無い
  if (!i.cloudHasContent) {
    return i.localHasContent ? "push" : "ready";
  }

  /*
   * 3. ここへ来るのは「両方に中身がある」場合だけ。
   *
   * 以前は突合済みなら push（この端末を正として全部送る）だった。
   * ところが送信は「手元に無い行はクラウドから消す」なので、**しばらく開いていなかった
   * 端末を開いた瞬間に、別の端末で足したものがクラウドから消える**。
   * 2026-09-14 本番で、古いスマホを開いて PC の目標1件と予定14件が消えた。
   * 突合済みでも中身が最新とは限らないので、合体してから送る。
   */
  return i.alreadySynced ? "merge" : "conflict";
}

/** 配列で持つキーと、1件を見分けるキー */
const MERGE_COLLECTIONS: Record<string, (x: Record<string, unknown>) => string> = {
  [KEY.cards]: (x) => String(x.id),
  [KEY.habits]: (x) => String(x.id),
  [KEY.timeboxes]: (x) => String(x.id),
  [KEY.checkpoints]: (x) => String(x.id),
  [KEY.archive]: (x) => String(x.id),
  [KEY.habitLogs]: (x) => `${String(x.habitId)}|${String(x.date)}`,
};

function parseArray(raw: string | undefined): Record<string, unknown>[] | null {
  if (raw === undefined) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : null;
  } catch {
    return null;
  }
}

/**
 * この端末（local）とクラウド（cloud）の中身を合体する。どちらも captureState() と同じ形。
 *
 * - 配列（目標・習慣・記録・予定・中間目標・対話の履歴）は、片方にしか無いものも両方残す
 * - 両方にあれば updatedAt が新しいほう。同じ・不明ならこの端末（いま見ている画面と食い違わせない）
 * - 1件だけのもの（大きな物語・プロフィール・進行中の対話）と端末固有のキーは、
 *   この端末にあればこの端末、無ければクラウド
 *
 * ■ 分かっている限界
 * 削除の記録（墓標）を持っていないので、**別の端末で消したものが、
 * それを持っている端末を開いたときに戻ってくる**ことがある。
 * 消えるより戻るほうが取り返しがつくので、こちらに倒している。
 */
export function mergeSnapshots(
  local: Record<string, string | undefined>,
  cloud: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = new Set([...Object.keys(cloud), ...Object.keys(local)]);
  for (const k of keys) {
    const keyOf = MERGE_COLLECTIONS[k];
    if (!keyOf) {
      const v = local[k] ?? cloud[k];
      if (v !== undefined) out[k] = v;
      continue;
    }
    const l = parseArray(local[k]);
    const c = parseArray(cloud[k]);
    if (!l && !c) {
      const v = local[k] ?? cloud[k];
      if (v !== undefined) out[k] = v;
      continue;
    }
    const byKey = new Map<string, Record<string, unknown>>();
    for (const x of c ?? []) byKey.set(keyOf(x), x);
    for (const x of l ?? []) {
      const other = byKey.get(keyOf(x));
      const mine = typeof x.updatedAt === "string" ? x.updatedAt : "";
      const theirs = other && typeof other.updatedAt === "string" ? other.updatedAt : "";
      if (!other || mine >= theirs) byKey.set(keyOf(x), x);
    }
    out[k] = JSON.stringify([...byKey.values()]);
  }
  return out;
}

/**
 * 外部キー違反か（Postgres のエラーコード 23503）。
 *
 * timeboxes は card_id → goal_cards、habit_id → habits を参照する。
 * 参照先がまだクラウドに無い枠が1件でも混ざると、
 * **その回の書き込みがまるごと拒否される**（実際に時間割だけが
 * 保存され続けず、別端末で見て初めて発覚した）。
 *
 * この失敗は「送る順番が悪かった」だけなので、依存順に全部送り直せば直る。
 * 呼び出し側はこれを見て自己修復を試みる。
 */
export function isForeignKeyViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === "23503") return true;
  // code が落ちている経路のために、文言でも拾う
  return (
    typeof e.message === "string" &&
    e.message.includes("foreign key constraint")
  );
}

/**
 * クラウドから取り込む（pull）とき、クラウドに対応するテーブルが無いので
 * この端末の値をそのまま持ち越すキーを選ぶ。
 *
 * restoreState() は対象キーを一度すべて消してから詰め直す。ここで拾わないと、
 * 取り込んだ瞬間に次のものが無警告で消える。
 * - 端末固有キー（走っている打刻・A/Bの割り当て・移行の版）
 * - 中間目標 `gc.checkpoints`（建て方の評価を含む）。まだ Supabase 同期が無い。
 *   「置き換える」を押すと、ログイン前に作った中間目標が全部消えていた
 *
 * 中間目標は、取り込んだ目標（pulledCardIds）にぶら下がるものだけ残す。
 * 親の目標がクラウドに無ければ画面のどこからも辿れない孤児になるため
 * （deleteCard() が中間目標も一緒に消すのと同じ考え）。
 */
export function carryOverOnPull(
  local: Record<string, string | undefined>,
  pulledCardIds: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of DEVICE_LOCAL_KEYS) {
    const v = local[k];
    if (v !== undefined) out[k] = v;
  }

  const raw = local[KEY.checkpoints];
  if (raw) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    if (Array.isArray(parsed)) {
      const ids = new Set(pulledCardIds);
      const kept = parsed.filter(
        (c) => !!c && typeof c === "object" && ids.has((c as { cardId?: unknown }).cardId as string),
      );
      if (kept.length > 0) out[KEY.checkpoints] = JSON.stringify(kept);
    }
  }
  return out;
}

/**
 * ローカルとクラウドの中間目標を合わせる（R16、2026-09-14）。
 *
 * 送信は「そのキーの中身でクラウドをまるごと突き合わせ、手元に無い行は消す」方式で、
 * すでに同期している端末は開くたびに全部を送り直す。中間目標のテーブルを足した直後に
 * それをそのまま走らせると、**最初に送った端末が、別の端末から上がった中間目標を消す**。
 * そこで端末ごとに最初の1回だけ、両方を合わせてから送る。
 *
 * - 片方にしか無いものは両方残す
 * - 両方にあれば更新時刻が新しいほう。同じならローカル（いま見ている画面と食い違わせない）
 */
export function mergeCheckpoints(local: Checkpoint[], cloud: Checkpoint[]): Checkpoint[] {
  const byId = new Map<string, Checkpoint>();
  for (const c of cloud) byId.set(c.id, c);
  for (const c of local) {
    const other = byId.get(c.id);
    if (!other || (c.updatedAt ?? "") >= (other.updatedAt ?? "")) byId.set(c.id, c);
  }
  return [...byId.values()];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * クラウドに送れる形か。
 * upsert は配列を1回で送るので、1件でも型の合わない行があるとその回が丸ごと拒否され、
 * 正常な中間目標まで届かなくなる（goal_cards の期限「3年後」で実際に起きた）。
 */
export function sendableCheckpoint(c: Checkpoint): boolean {
  return (
    isValidUuid(c.id) &&
    isValidUuid(c.cardId) &&
    DATE_RE.test(c.period?.start ?? "") &&
    DATE_RE.test(c.period?.end ?? "") &&
    (c.period?.kind === "week" || c.period?.kind === "month") &&
    (c.status === "active" || c.status === "done" || c.status === "abandoned")
  );
}
