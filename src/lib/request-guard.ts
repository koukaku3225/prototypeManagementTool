/**
 * APIルートの入口で使う、リクエストの形と出どころの検査。
 *
 * 2026-09-14 のセキュリティレビュー（docs/reports/2026-09-14-security-review.md）の
 * 指摘3（Content-Type のすり抜け）・補足（本文サイズの検査が読み込み後）・
 * 指摘1（バックアップAPIの無防備）をまとめて受ける。
 * ルートごとに書くと、どれか1つだけ古い判定のまま残るので、ここに集める。
 */

/**
 * Content-Type が JSON か。
 *
 * 以前は `includes("application/json")` で見ていたので、
 * `text/plain; note=application/json` でも通っていた。
 * ブラウザはパラメータを除いた MIME タイプで「プリフライトが要るか」を決めるため、
 * この値はプリフライト無しでクロスサイトから送れてしまう。
 * パラメータを外して、完全一致で比べる。
 */
export function isJsonContentType(header: string | null): boolean {
  if (!header) return false;
  const mime = header.split(";")[0].trim().toLowerCase();
  return mime === "application/json";
}

/**
 * 別サイトのページから送られてきたリクエストか。
 *
 * ブラウザは Sec-Fetch-Site を必ず付ける（利用者が書き換えられない）。
 * 付いていなければ Origin で見る。どちらも無いのはブラウザ以外（curl 等）で、
 * それは「他人のブラウザに踏ませる」攻撃（CSRF）にはならないので通す。
 */
export function isCrossSiteRequest(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}

export type BodyReadResult =
  | { ok: true; text: string }
  | { ok: false; status: 400 | 413 };

/**
 * 本文を、上限バイト数を超えた時点で読むのをやめて取り出す。
 *
 * `await req.text()` のあとで長さを見ると、巨大な本文でも一旦ぜんぶメモリに載る。
 * しかも `string.length` は文字数でバイト数ではない（日本語は1文字3バイト）。
 * 流れてくるバイトを数え、超えたら打ち切る。
 */
export async function readBodyLimited(
  req: Request,
  maxBytes: number,
): Promise<BodyReadResult> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };
  if (!req.body) return { ok: true, text: "" };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(buf) };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** Host ヘッダがこのPC自身（loopback）を指しているか。ポートは問わない */
export function isLoopbackHost(host: string | null): boolean {
  if (!host) return false;
  let name = host.trim().toLowerCase();
  if (name.startsWith("[")) {
    name = name.slice(1, name.indexOf("]"));
  } else {
    name = name.replace(/:\d+$/, "");
  }
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}
