/**
 * /api/structure の応答を、画面に出せる形に読み分ける。
 *
 * 2026-09-14、目標の整理が「Unexpected token 'A', "An error o"... is not valid JSON」で
 * 失敗した。整理（claude-sonnet-5）に実測75秒かかり、maxDuration=60 で Vercel が
 * 関数を打ち切って、JSONではない素のテキスト（"An error occurred with your deployment
 * FUNCTION_INVOCATION_TIMEOUT"）を返した。画面側がそれを res.json() で読もうとして
 * 構文エラーになり、原因の分からない英語がそのまま出ていた。
 *
 * 加えて、失敗すると黙って1回やり直していたため、打ち切りでも待ち時間と課金が倍になっていた。
 * 打ち切りは同じ条件で再送しても同じように打ち切られるので、自動ではやり直さない。
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; retryable: boolean };

const SAVED = "対話は保存されているので、もう一度試せます。";

export function parseApiResponse<T>(status: number, contentType: string | null, text: string): ApiResult<T> {
  const isJson = (contentType ?? "").includes("application/json");

  if (isJson) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, message: `応答を読み取れませんでした（HTTP ${status}）。${SAVED}`, retryable: false };
    }
    if (status >= 200 && status < 300) return { ok: true, data: data as T };
    const message = (data as { message?: unknown } | null)?.message;
    return {
      ok: false,
      message: typeof message === "string" && message ? message : "整理に失敗しました。",
      // 混雑（429）は待ってから本人が押し直すもの。5xx の一時的な失敗だけ自動で1回やり直す
      retryable: status >= 500 && status !== 504,
    };
  }

  if (status === 504 || /FUNCTION_INVOCATION_TIMEOUT|timed? ?out/i.test(text)) {
    return { ok: false, message: `整理に時間がかかりすぎて、途中で止まりました。${SAVED}`, retryable: false };
  }
  return { ok: false, message: `サーバーで問題が起きました（HTTP ${status}）。${SAVED}`, retryable: false };
}

export async function readApiResponse<T>(res: Response): Promise<ApiResult<T>> {
  return parseApiResponse<T>(res.status, res.headers.get("content-type"), await res.text());
}
