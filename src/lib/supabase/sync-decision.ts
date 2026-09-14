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
const MERGE_COLLECTIONS: Partial<Record<string, (x: Record<string, unknown>) => string>> = {
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
  return mergeWithReport(local, cloud).data;
}

const stamp = (x: Record<string, unknown> | undefined): string =>
  x && typeof x.updatedAt === "string" ? x.updatedAt : "";

/**
 * mergeSnapshots の本体。**この端末の中身が実際に変わったか**も返す。
 *
 * changed を文字列の比較で出すと、並び順やクラウド側の表現（null の有無など）の違いだけで
 * 毎回「変わった」になり、合体 → 送信 → 再読み込みが止まらなくなる（2026-09-14 本番で発生）。
 * そこで、この端末の並びと表現をそのまま残し、変わったと言うのは次のときだけにする。
 *   - クラウドにしか無いものを足した
 *   - 両方にあって、クラウドのほうが新しかったので置き換えた
 *   - この端末に無い1件もの・キーをクラウドから足した
 * 置き換えた後にもう一度合わせると更新時刻が同じになるので、必ず changed=false に収束する。
 */
export function mergeWithReport(
  local: Record<string, string | undefined>,
  cloud: Record<string, string | undefined>,
): { data: Record<string, string>; changed: boolean } {
  const out: Record<string, string> = {};
  let changed = false;
  const keys = new Set([...Object.keys(local), ...Object.keys(cloud)]);
  for (const k of keys) {
    const keyOf = MERGE_COLLECTIONS[k];
    const l = keyOf ? parseArray(local[k]) : null;
    const c = keyOf ? parseArray(cloud[k]) : null;
    if (!keyOf || (!l && !c)) {
      if (local[k] !== undefined) out[k] = local[k] as string;
      else if (cloud[k] !== undefined) {
        out[k] = cloud[k] as string;
        changed = true;
      }
      continue;
    }
    if (!l) {
      out[k] = cloud[k] as string;
      if ((c ?? []).length > 0) changed = true;
      continue;
    }
    const cloudBy = new Map((c ?? []).map((x) => [keyOf(x), x]));
    let keyChanged = false;
    // この端末の並びを保つ。クラウドが新しいものだけ差し替える
    const merged = l.map((x) => {
      const other = cloudBy.get(keyOf(x));
      cloudBy.delete(keyOf(x));
      if (other && stamp(other) > stamp(x)) {
        keyChanged = true;
        return other;
      }
      return x;
    });
    // クラウドにしか無いものは後ろに足す
    for (const x of cloudBy.values()) {
      merged.push(x);
      keyChanged = true;
    }
    out[k] = keyChanged ? JSON.stringify(merged) : (local[k] as string);
    if (keyChanged) changed = true;
  }
  return { data: out, changed };
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

/**
 * 1行ぶんの中身の指紋（cyrb53 の16進）。「前回送ったときから変わったか」を見るだけに使う。
 * 行をまるごと覚えると localStorage を圧迫するので、短い値にする。
 */
export function rowFingerprint(row: unknown): string {
  const s = JSON.stringify(row) ?? "";
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** この端末が前回クラウドへ送った（またはクラウドから受け取った）各行の指紋。行のキー → 指紋 */
export type PushBase = Record<string, string>;

/**
 * 配列で持つコレクションを送るとき、どの行を書き、どの行を消すかを決める（2026-09-15）。
 *
 * ■ 以前の問題
 * 保存のたびに「この端末の全行を upsert し、この端末に無い行はクラウドから消す」をしていた。
 * これだと**開きっぱなしの端末で1件保存しただけで、その後に別の端末が足した行がクラウドから消え、
 * 別の端末が直した行も古い中身で上書きされる**。2026-09-15 に本番で、別端末の追加を模した行が
 * 予定1件の保存で消えることを確かめた。開いたときの合体（mergeWithReport）は開いた瞬間しか守らない。
 *
 * ■ ここでの決め方
 * 基準（base）＝この端末が前回クラウドとそろえたときの各行の指紋。
 * - 書く：基準と指紋が違う行（この端末で足した・直した行）。mode="full" なら全部
 * - 消す：基準にあって、いまこの端末に無い行（＝この端末で消した行）だけ
 * - 基準にもこの端末にも無い行（別の端末が足した行）には触らない
 * - 基準が無い（初めて・別アカウント）なら、全部書いて何も消さない。消えるより余るほうがまし
 *
 * localKeys には送れなかった行（不正なID）も含めること。含めないと「この端末で消した」と誤る。
 */
export function planCollectionPush(
  base: PushBase | null,
  rows: readonly { key: string; fp: string }[],
  localKeys: readonly string[],
  mode: "diff" | "full",
): { upsert: string[]; remove: string[]; next: PushBase } {
  const next: PushBase = {};
  const upsert: string[] = [];
  for (const r of rows) {
    next[r.key] = r.fp;
    if (mode === "full" || !base || base[r.key] !== r.fp) upsert.push(r.key);
  }
  const local = new Set(localKeys);
  const remove = base ? Object.keys(base).filter((k) => !local.has(k)) : [];
  return { upsert, remove, next };
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
