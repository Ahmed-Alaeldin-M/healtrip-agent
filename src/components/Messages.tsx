"use client";

import { useEffect, useState } from "react";
import Markdown from "react-markdown";
import { displayError, formatTime, strings } from "@/lib/chat/i18n";
import type { ChatMessage, Lang } from "@/lib/chat/types";
import { AlertIcon, Sparkle } from "./icons";

function useCountdown(until?: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= until) window.clearInterval(id);
    }, 500);
    return () => window.clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

function ErrorCard({
  message,
  lang,
  isLast,
  chatFull,
  onRetry,
  onEdit,
  onNewChat,
}: {
  message: ChatMessage;
  lang: Lang;
  isLast: boolean;
  chatFull: boolean;
  onRetry: () => void;
  onEdit: () => void;
  onNewChat: () => void;
}) {
  const t = strings(lang);
  const err = message.error!;
  const wait = useCountdown(err.retryAt);
  const needsNewChat = err.code === "LLM_CONTEXT_LENGTH";
  return (
    <div className="msg-error" role="alert">
      <AlertIcon />
      <div>
        <div>{displayError(err, lang)}</div>
        {isLast && (
          <div className="msg-actions">
            {needsNewChat ? (
              <button className="btn-small primary" onClick={onNewChat} type="button">{t.newChat}</button>
            ) : (
              <>
                {err.retryable && !chatFull && (
                  <button className="btn-small primary" disabled={wait > 0} onClick={onRetry} type="button">
                    {wait > 0 ? t.retryIn(wait) : t.retry}
                  </button>
                )}
                <button className="btn-small" onClick={onEdit} type="button">{t.editResend}</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  lang,
  pending,
  phase,
  slow,
  chatFull,
  onRetry,
  onEdit,
  onNewChat,
}: {
  messages: ChatMessage[];
  lang: Lang;
  pending: boolean;
  phase?: string;
  slow: boolean;
  chatFull: boolean;
  onRetry: (id: string) => void;
  onEdit: (id: string) => void;
  onNewChat: () => void;
}) {
  const t = strings(lang);
  const streaming = messages.at(-1)?.status === "streaming";
  return (
    <div aria-busy={pending} aria-live="polite" aria-relevant="additions" className="messages" role="log">
      {messages.map((m, i) => {
        const isLast = i === messages.length - 1;
        if (m.role === "assistant") {
          const writing = m.status === "streaming";
          return (
            <div className="assistant-row" key={m.id}>
              <span className="agent-avatar" aria-hidden="true"><Sparkle /></span>
              <div className="assistant-col">
                <span className="visually-hidden">{t.assistantLabel}</span>
                <div className={`assistant-bubble ${writing ? "is-streaming" : ""}`} dir="auto">
                  <div className="md">
                    <Markdown
                      components={{
                        a: ({ node: _node, ...props }) => <a {...props} rel="noopener noreferrer nofollow" target="_blank" />,
                      }}
                    >
                      {m.content}
                    </Markdown>
                  </div>
                  {writing && <span aria-hidden="true" className="caret" />}
                </div>
                {!writing && <span className="msg-time">{formatTime(m.createdAt, lang)}</span>}
              </div>
            </div>
          );
        }
        return (
          <div className="contents" key={m.id} style={{ display: "contents" }}>
            <div className={`sent-message in-thread ${m.status === "pending" ? "is-pending" : ""} ${m.status === "error" ? "is-failed" : ""}`} dir="auto">
              <span className="visually-hidden">{t.youLabel}</span>
              <span>{m.content}</span>
              <small>{m.status === "error" ? t.attempt : formatTime(m.createdAt, lang)}</small>
            </div>
            {m.status === "error" && m.error && (
              <ErrorCard
                chatFull={chatFull}
                isLast={isLast}
                lang={lang}
                message={m}
                onEdit={() => onEdit(m.id)}
                onNewChat={onNewChat}
                onRetry={() => onRetry(m.id)}
              />
            )}
          </div>
        );
      })}
      {pending && !streaming && (
        <div className="typing-row">
          <span aria-label={t.thinking} className="typing" role="status">
            <i /><i /><i />
          </span>
          {phase === "searching" ? <span className="typing-note">{t.searching}</span> : slow ? <span className="typing-note">{t.stillWorking}</span> : null}
        </div>
      )}
    </div>
  );
}
