"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DELAY_PHASES,
  type AnyPhaseId,
  type ChatMessage,
  type DraftEvents,
  type Session,
} from "@/types/goal";
import { loadBigStory, loadProfile, saveSession } from "@/lib/storage";

export const LOCK_MS = 60_000;

export type ConversationStatus = "idle" | "streaming" | "error" | "done";

interface State {
  session: Session;
  streamingText: string;
  status: ConversationStatus;
  error: string | null;
  lockUntil: number | null;
  /**
   * 次へ進む準備ができたステップ。ユーザーが「次へ」を押すまで適用しない。
   * 自動で進んでしまうと「どこに向かっているのか分からない」ため、
   * 遷移の主導権はユーザーに残す（上限到達時の強制遷移だけは例外）。
   */
  pendingPhase: AnyPhaseId | "done" | null;
  /** ターン上限に達しての遷移提案か（文言を変えるためだけに使う） */
  pendingForced: boolean;
  /** ステップ確定直後に、新しいステップの問いをコーチから切り出させる */
  autoSend: boolean;
}

export function useConversation(initial: Session) {
  const [state, setState] = useState<State>({
    session: initial,
    streamingText: "",
    status: "idle",
    error: null,
    lockUntil: null,
    pendingPhase: null,
    pendingForced: false,
    autoSend: false,
  });

  const abortRef = useRef<AbortController | null>(null);
  /** 直前に送って失敗したユーザー発言。再送に使う */
  const pendingRef = useRef<{ text: string; draft?: DraftEvents } | null>(null);

  useEffect(() => {
    saveSession(state.session);
  }, [state.session]);

  const send = useCallback(
    async (userText: string | null, draft?: DraftEvents) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      if (userText !== null) pendingRef.current = { text: userText, draft };

      let working: Session = state.session;

      if (userText !== null) {
        const userMsg: ChatMessage = {
          role: "user",
          content: userText,
          phase: working.currentPhase,
          timestamp: new Date().toISOString(),
          ...(draft ? { draftEvents: draft } : {}),
        };
        working = { ...working, messages: [...working.messages, userMsg] };
      }

      setState((s) => ({
        ...s,
        session: working,
        streamingText: "",
        status: "streaming",
        error: null,
        lockUntil: null,
      }));

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            mode: working.mode,
            coachId: working.coachId,
            phase: working.currentPhase,
            turnsInPhase: working.phaseTurnCounts[working.currentPhase] ?? 0,
            messages: toApiMessages(working),
            profile: loadProfile(),
            bigStory: working.mode === "small" ? loadBigStory() : null,
            commitmentStep: working.variant.commitmentStep,
          }),
        });

        if (!res.ok || !res.body) {
          const detail = await res.json().catch(() => null);
          throw new Error(
            detail?.message ?? "応答を取得できませんでした。もう一度送ってください。",
          );
        }

        await consumeSse(res.body, {
          onDelta: (text) =>
            setState((s) => ({ ...s, streamingText: s.streamingText + text })),
          onError: (message) => {
            throw new Error(message);
          },
          onDone: ({ phase, forced }) => {
            pendingRef.current = null;
            setState((s) => finalize(s, working, phase, forced));
          },
        });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setState((s) => ({
          ...s,
          status: "error",
          error: err instanceof Error ? err.message : "通信に失敗しました。",
        }));
      }
    },
    [state.session],
  );

  /** 「次へ」を押したときにだけステップを進める */
  const advance = useCallback(() => {
    setState((s) => {
      if (!s.pendingPhase || s.status === "streaming") return s;
      const session = applyPhase(s.session, s.pendingPhase, new Date().toISOString());
      const finished = s.pendingPhase === "done";
      return {
        ...s,
        session,
        pendingPhase: null,
        pendingForced: false,
        lockUntil: null,
        status: finished ? "done" : "idle",
        // 新しいステップの問いは、ユーザーに書かせるのではなくコーチから切り出す
        autoSend: !finished,
      };
    });
  }, []);

  // ステップ確定直後の1回だけ、コーチに次の問いを出させる
  useEffect(() => {
    if (!state.autoSend) return;
    setState((s) => ({ ...s, autoSend: false }));
    void send(null);
  }, [state.autoSend, send]);

  /** 直前の失敗を再送する（ユーザー発言は重複させない） */
  const retry = useCallback(() => {
    const rolledBack: Session = {
      ...state.session,
      messages: state.session.messages.slice(0, -1),
    };
    const p = pendingRef.current;
    setState((s) => ({ ...s, session: rolledBack }));
    if (p) void send(p.text, p.draft);
  }, [send, state.session]);

  return {
    ...state,
    send,
    retry,
    advance,
    isLocked: state.lockUntil !== null && Date.now() < state.lockUntil,
  };
}

/**
 * ストリーム完了時にセッションを確定させる。
 *
 * ステップが進む判定が出ても、ここでは適用せず pendingPhase に置くだけにする。
 * 実際の遷移は advance()（ユーザーの「次へ」）で行う。
 * ただし forced（ターン上限到達）のときは堂々巡り防止が優先なので即座に進める。
 */
function finalize(
  s: State,
  working: Session,
  phase: AnyPhaseId | "done",
  forced: boolean,
): State {
  const text = s.streamingText;
  const prevPhase = working.currentPhase;

  const assistantMsg: ChatMessage = {
    role: "assistant",
    content: text,
    phase: prevPhase,
    timestamp: new Date().toISOString(),
  };

  const advanced = phase !== prevPhase;
  const now = new Date().toISOString();

  const counted: Session = {
    ...working,
    messages: [...working.messages, assistantMsg],
    phaseTurnCounts: {
      ...working.phaseTurnCounts,
      [prevPhase]: (working.phaseTurnCounts[prevPhase] ?? 0) + 1,
    },
  };

  // 待ち時間ロックは「熟考が要るステップで、問いで終わっている」ときだけ
  const shouldLock =
    !advanced &&
    counted.variant.deliberateDelay &&
    (DELAY_PHASES as readonly string[]).includes(prevPhase) &&
    endsWithQuestion(text);

  return {
    ...s,
    session: counted,
    streamingText: "",
    status: "idle",
    error: null,
    lockUntil: shouldLock ? Date.now() + LOCK_MS : null,
    // forced（上限到達）でも自動では進めない。コーチが問いを投げた直後に
    // 画面が切り替わると「質問が打ち切られた」ように見えるため、
    // 進むかどうかは必ずユーザーに選ばせる。
    pendingPhase: advanced ? phase : null,
    pendingForced: advanced ? forced : false,
    autoSend: false,
  };
}

/**
 * API に渡す会話履歴を組み立てる。
 *
 * - 末尾の空白は落とす。アシスタント発言が空白で終わっていると 400 になる
 * - 末尾がアシスタントのままだと役割が交互にならないので、
 *   合図となるユーザー発言を足す（保存はしない。この1回のリクエスト限り）
 */
function toApiMessages(
  session: Session,
): { role: "user" | "assistant"; content: string }[] {
  const msgs = session.messages
    .map((m) => ({ role: m.role, content: m.content.trim() }))
    .filter((m) => m.content.length > 0);

  if (msgs.length === 0) {
    return [{ role: "user", content: "（対話を始めてください）" }];
  }
  if (msgs[msgs.length - 1].role === "assistant") {
    return [...msgs, { role: "user", content: "（次のステップに進んでください）" }];
  }
  return msgs;
}

/** ステップ遷移をセッションに反映する */
function applyPhase(
  session: Session,
  phase: AnyPhaseId | "done",
  now: string,
): Session {
  if (phase === "done") {
    return {
      ...session,
      completedAt: now,
      phaseStatus: { ...session.phaseStatus, [session.currentPhase]: "done" },
    };
  }
  return {
    ...session,
    currentPhase: phase,
    phaseStatus: {
      ...session.phaseStatus,
      [session.currentPhase]: "done",
      [phase]: "current",
    },
    phaseEnteredAt: { ...session.phaseEnteredAt, [phase]: now },
  };
}

function endsWithQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text.trim());
}

interface SseHandlers {
  onDelta: (text: string) => void;
  onDone: (payload: { phase: AnyPhaseId | "done"; forced: boolean }) => void;
  onError: (message: string) => void;
}

async function consumeSse(body: ReadableStream<Uint8Array>, h: SseHandlers) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

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

      const payload = JSON.parse(dataLine[1]);
      if (eventLine[1] === "delta") h.onDelta(payload.text);
      else if (eventLine[1] === "done") h.onDone(payload);
      else if (eventLine[1] === "error") h.onError(payload.message);
    }
  }
}
