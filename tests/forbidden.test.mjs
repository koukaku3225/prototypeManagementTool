/**
 * 入れてはいけないものが入っていないかを見張る。
 *
 * このアプリは localStorage に対話全文・過去の挫折・価値観を平文で持っている。
 * XSS が1箇所でも生えると、1リクエストでその全部が外に出る。
 * いま実在する XSS 経路はゼロなので、守るべきは「ゼロのままにすること」。
 *
 * ESLint を丸ごと導入する代わりにこれを置いている。理由は AGENTS.md 参照。
 * 実行は `npm test`（CI でも回る）。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// リポジトリのパスに日本語が含まれる（…/副業/…）。
// URL.pathname は %E5%89%AF… のまま返るので、必ず fileURLToPath を通す
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "src");

/** 見つけたら落とすもの。why は落ちたときに読まれる文章なので、直し方まで書く */
const FORBIDDEN = [
  {
    pattern: /dangerouslySetInnerHTML/,
    why:
      "生HTMLを描画すると、AIの出力経由でXSSが成立する。" +
      "Markdownを出したいなら react-markdown を rehype-raw なしで使い、" +
      "rehype-sanitize を明示的にチェーンすること。",
  },
  {
    pattern: /\.innerHTML\s*=/,
    why: "同上。textContent を使うか、Reactの子要素として渡すこと。",
  },
  {
    pattern: /\bdocument\.write\s*\(/,
    why: "同上。",
  },
  {
    pattern: /\beval\s*\(/,
    why: "任意コード実行の経路になる。",
  },
  {
    pattern: /new\s+Function\s*\(/,
    why: "eval と同じ。",
  },
  {
    pattern: /NEXT_PUBLIC_[A-Z_]*(?:API_KEY|SECRET|TOKEN)/,
    why:
      "NEXT_PUBLIC_ 接頭辞の値はクライアントに埋め込まれる。" +
      "APIキーやトークンを入れてはいけない。",
  },
  {
    pattern: /sk-ant-[A-Za-z0-9_-]{10}/,
    why: "APIキーがソースに直書きされている。.env.local へ移すこと。",
  },
];

/** package.json 側で禁じるもの */
const FORBIDDEN_DEPS = [
  {
    name: "rehype-raw",
    why:
      "react-markdown と併用すると生HTMLが通り、XSSが成立する。" +
      "どうしても必要なら rehype-sanitize を必ず後段に置き、" +
      "この行を消す前に AGENTS.md を読むこと。",
  },
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|mts|mjs|js|jsx)$/.test(p)) out.push(p);
  }
  return out;
}

let failed = 0;
let checked = 0;

for (const file of walk(SRC)) {
  const text = readFileSync(file, "utf8");
  checked++;
  text.split("\n").forEach((line, i) => {
    // 自分自身の説明文やコメントで落ちないよう、コメント行は見ない
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(line)) {
        failed++;
        console.error(
          `✗ ${relative(ROOT, file)}:${i + 1}\n  ${trimmed}\n  → ${rule.why}\n`,
        );
      }
    }
  });
}

/*
 * 構造の不変条件。行単位の禁止パターンでは表せないので、別に見る。
 *
 * 同期フック（setSyncHook）は「ローカルに無いものをクラウドから消す」処理の
 * 引き金になる。だから繋ぐ場所は enablePush() / disablePush() の2つに限る。
 * 別の場所から直接繋がれると、向きが決まる前に繋がってしまい、
 * 空の端末がクラウドを消す経路が再びできる（実際にそうなっていた）。
 */
{
  const syncFile = join(SRC, "lib", "supabase", "sync.ts");
  const text = readFileSync(syncFile, "utf8");
  const lines = text.split("\n");
  /** setSyncHook を呼んでよい関数 */
  const ALLOWED = ["enablePush", "disablePush", "pullAll"];
  let current = null;
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    const fn = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (fn) current = fn[1];
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    if (!/\bsetSyncHook\s*\(/.test(line)) return;
    if (trimmed.startsWith("import") || trimmed.startsWith("}")) return;
    if (current && ALLOWED.includes(current)) return;
    failed++;
    console.error(
      `✗ ${relative(ROOT, syncFile)}:${i + 1}（${current ?? "トップレベル"} の中）\n` +
        `  ${trimmed}\n` +
        `  → setSyncHook を繋いでよいのは ${ALLOWED.join(" / ")} だけ。\n` +
        `    向きが決まる前に繋ぐと、空の端末がクラウドのデータを消す\n`,
    );
  });
}

/*
 * 補助的な仕組みの失敗が、主機能を止めてはいけない。
 *
 * レート制限は費用を守るための保険であって、対話そのものではない。
 * ところが例外を投げっぱなしだったため、Upstashのトークンが無効になった
 * だけで /api/chat が丸ごと500になり、目標設定ができなくなった。
 * 外部サービスに問い合わせる保険は、失敗しても通す（fail open）こと。
 */
{
  const file = join(SRC, "lib", "rate-limit.ts");
  const text = readFileSync(file, "utf8");
  const fn = text.slice(text.indexOf("export async function checkRateLimit"));
  if (!/\bcatch\s*\(/.test(fn)) {
    failed++;
    console.error(
      `✗ ${relative(ROOT, file)}\n` +
        `  checkRateLimit に catch がない\n` +
        `  → Upstashが落ちるとAPIルートごと500になり、対話が使えなくなる。\n` +
        `    確認できなければ通す（ログは必ず残す）\n`,
    );
  }
}

/*
 * カレンダー同期は、Supabase同期の向きが決着してからでないと走らせない。
 *
 * まっさらな端末で走ると「全部アプリで消された」と誤判定して
 * カレンダー側を空にする。クラウド同期で実際に踏んだ形なので、
 * ガードが外れていないことを機械的に見張る。
 */
{
  const file = join(SRC, "components", "CalendarSyncBoot.tsx");
  const text = readFileSync(file, "utf8");
  if (!/getSyncState\(\)\.kind\s*!==\s*"ready"/.test(text)) {
    failed++;
    console.error(
      `✗ ${relative(ROOT, file)}\n` +
        `  同期開始前の getSyncState() === "ready" の確認が無い\n` +
        `  → 空の端末で走ると、カレンダー側の予定を全部消しにいく\n`,
    );
  }

  /*
   * カレンダーは title/start/end しか持たない。
   * サーバーから返った値で meta / review / cardId / color を書き換えると、
   * 本人が書いたメタ認知と振り返りが同期のたびに消える。
   */
  for (const field of ["meta", "review", "cardId", "color"]) {
    if (new RegExp(`\\bu\\.${field}\\b`).test(text)) {
      failed++;
      console.error(
        `✗ ${relative(ROOT, file)}\n` +
          `  同期結果から ${field} を読んでいる\n` +
          `  → カレンダーはこの項目を持たない。書き戻すと本人の記入が消える\n`,
      );
    }
  }
}

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
for (const rule of FORBIDDEN_DEPS) {
  if (deps[rule.name]) {
    failed++;
    console.error(`✗ package.json に ${rule.name}\n  → ${rule.why}\n`);
  }
}

if (failed > 0) {
  console.error(`${failed} 件の禁止パターンが見つかりました（${checked}ファイル走査）`);
  process.exit(1);
}
console.log(`禁止パターンなし（${checked}ファイル走査）`);
