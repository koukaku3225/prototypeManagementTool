"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DELAY_PHASES,
  type ChatMessage,
  type DraftEvents,
  type PhaseId,
  type Session,
} from "@/types/goal";
import { loadProfile, saveSession } from "@/lib/storage";

export const LOCK_MS = 60_000;

export type ConversationStatus = "idle" | "streaming" | "error" | "done";

interface State {
  session: Session;
  streamingText: string;
  status: ConversationStatus;
  error: string | null;
  lockUntil: number | null;
}

export function useConversation(initial: Session) {
  const [state, setState] = useState<State>({
    session: initial,
    streamingText: "",
    status: "idle",
    error: null,
    lockUntil: null,
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
            coachId: working.coachId,
            phase: working.currentPhase,
            turnsInPhase: working.phaseTurnCounts[working.currentPhase],
            messages: working.messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            profile: loadProfile(),
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
          onDone: ({ phase }) => {
            pendingRef.current = null;
            setState((s) => finalize(s, working, phase));
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
    isLocked: state.lockUntil !== null && Date.now() < state.lockUntil,
  };
}

/** ストリーム完了時にセッションを確定させる */
function finalize(s: State, working: Session, phase: PhaseId | "done"): State {
  const text = s.streamingText;
  const prevPhase = working.currentPhase;

  const assistantMsg: ChatMessage = {
    role: "assistant",
    content: text,
    phase: prevPhase,
    timestamp: new Date().toISOString(),
  };

  const advanced = phase !== prevPhase;
  const finished = phase === "done";
  const now = new Date().toISOString();

  const session: Session = {
    ...working,
    messages: [...working.messages, assistantMsg],
    currentPhase: finished ? prevPhase : (phase as PhaseId),
    completedAt: finished ? now : null,
    phaseTurnCounts: {
      ...working.phaseTurnCounts,
      [prevPhase]: working.phaseTurnCounts[prevPhase] + 1,
    },
    phaseEnteredAt:
      advanced && !finished
        ? { ...working.phaseEnteredAt, [phase as PhaseId]: now }
        : working.phaseEnteredAt,
  };

  // 待ち時間ロックは「深さが要る2フェーズで、問いで終わっている」ときだけ
  const nextPhase = session.currentPhase;
  const shouldLock =
    !finished &&
    session.variant.deliberateDelay &&
    (DELAY_PHASES as readonly string[]).includes(nextPhase) &&
    endsWithQuestion(text);

  return {
    ...s,
    session,
    streamingText: "",
    status: finished ? "done" : "idle",
    error: null,
    lockUntil: shouldLock ? Date.now() + LOCK_MS : null,
  };
}

function endsWithQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text.trim());
}

interface SseHandlers {
  onDelta: (text: string) => void;
  onDone: (payload: { phase: PhaseId | "done" }) => void;
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
