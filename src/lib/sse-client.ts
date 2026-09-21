/**
 * `/api/chat` の SSE を読む側。
 *
 * サーバーは応答の最後に必ず `done` を送る（`app/api/chat/route.ts`）。
 * `done` が来ないまま流れが閉じたら、それは「途中で途切れた」ということで、
 * 成功ではない。以前はここを見ておらず、`useConversation` の status が
 * "streaming" のまま戻らなかった。入力欄は streaming 中は無効なので、
 * 送り直す手段が画面から消え、再読み込みするしかなかった。
 * （関数の実行時間の上限・回線の切れ・上流の異常終了で起こりうる）
 */
import type { AnyPhaseId, TokenUsage } from "@/types/goal";

export interface SseHandlers {
  onDelta: (text: string) => void;
  onDone: (payload: {
    phase: AnyPhaseId | "done";
    forced: boolean;
    usage?: TokenUsage;
  }) => void;
  onError: (message: string) => void;
}

/** イベントごとに中身が違うが、使う側は event 名で読み分ける */
type Frame = { text: string; message: string } & Parameters<SseHandlers["onDone"]>[0];

/** 途中で途切れたときに、利用者に見せる文言 */
export const STREAM_CUT_MESSAGE =
  "応答が途中で途切れました。もう一度送ってください。";

const BROKEN_FRAME_MESSAGE =
  "応答をうまく受け取れませんでした。もう一度送ってください。";

/**
 * 流れを最後まで読む。`done` を受け取れなかったら例外を投げる。
 * 例外は呼び出し側の catch で「エラー状態＋再送ボタン」になる。
 */
export async function consumeSse(
  body: ReadableStream<Uint8Array>,
  h: SseHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let finished = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);

      const eventLine = raw.match(/^event: (.+)$/m);
      const dataLine = raw.match(/^data: (.+)$/m);
      if (!eventLine || !dataLine) continue;

      let payload: Frame;
      try {
        payload = JSON.parse(dataLine[1]);
      } catch {
        throw new Error(BROKEN_FRAME_MESSAGE);
      }
      if (eventLine[1] === "delta") h.onDelta(payload.text);
      else if (eventLine[1] === "done") {
        finished = true;
        h.onDone(payload);
      } else if (eventLine[1] === "error") h.onError(payload.message);
    }
  }

  if (!finished) throw new Error(STREAM_CUT_MESSAGE);
}
