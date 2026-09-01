import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { LocalBackupSchema } from "@/lib/api-schema";

/**
 * ローカルディスクへのバックアップ。
 *
 * localStorage が丸ごと消える事故が実際に起きた（原因は特定できていない）。
 * スナップショット機能もJSON書き出しも、結局「同じブラウザの中」にあるので
 * サイトデータの一括削除に同じように弱い。ここはブラウザの外、
 * このPCのディスクに置くので、ブラウザ側で何が起きても残る。
 *
 * ログインの有無に関係なく動く（サーバーは自分のPC上で動いている前提のため、
 * 認証を挟む理由がない）。デプロイ後のサーバーレス環境ではディスクが
 * 読み書きできない・永続しないので、これは開発中だけの安全網。
 */
export const runtime = "nodejs";

const DIR = path.join(process.cwd(), ".local-backups");
const LATEST = path.join(DIR, "latest.json");
/** 世代を残す。1つだけ上書きだと、空の状態を書いた瞬間に前のぶんが消える */
const KEEP = 30;
/**
 * 対話全文まで含む状態の丸ごとダンプなので、api-schema.ts の
 * MAX_BODY_BYTES（1リクエスト分のコスト上限）よりずっと大きく取る。
 * 自分のPC上だけで完結する経路であり、上限は暴走・破損データ避けの意味しかない。
 */
const MAX_BODY_BYTES = 5_000_000;

async function ensureDir() {
  await mkdir(DIR, { recursive: true });
}

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    return Response.json({ error: "unsupported_media_type" }, { status: 415 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ error: "too_large" }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const parsed = LocalBackupSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const data = parsed.data;

  // 空っぽの状態をそのまま「最新」として書くと、直前の良い状態を
  // latest.json から追い出してしまう。空なら世代だけ残して latest は更新しない
  const hasContent = Object.values(data).some((v) => v && v !== "[]" && v !== "{}");

  try {
    await ensureDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(DIR, `backup-${stamp}.json`);
    await writeFile(file, JSON.stringify(data), "utf-8");

    if (hasContent) {
      await writeFile(LATEST, JSON.stringify(data), "utf-8");
    }

    // 古い世代を掃除する
    const files = (await readdir(DIR)).filter((f) => f.startsWith("backup-")).sort();
    const excess = files.length - KEEP;
    if (excess > 0) {
      await Promise.all(
        files.slice(0, excess).map((f) => unlink(path.join(DIR, f)).catch(() => {})),
      );
    }

    return Response.json({ ok: true, hasContent });
  } catch (err) {
    // 書けなくても致命的ではない。localStorage 側の保存は成功している
    return Response.json(
      { error: "write_failed", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const raw = await readFile(LATEST, "utf-8");
    return Response.json({ ok: true, data: JSON.parse(raw) });
  } catch {
    return Response.json({ ok: false, data: null });
  }
}
