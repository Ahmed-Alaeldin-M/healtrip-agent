import { clientError } from "./i18n";
import type { Lang, MessageError } from "./types";

export const CLIENT_TIMEOUT_MS = 65_000;
export const STREAM_IDLE_MS = 30_000; // server heartbeats every 15s, so silence this long means the connection is dead
export const STREAM_TOTAL_MS = 120_000;

export interface SendArgs {
  message: string;
  language: Lang;
  threadId: string;
  history: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type SendResult = { ok: true; answer: string } | { ok: false; error: MessageError };

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** Interprets a complete (non-streamed) JSON response from /api/chat. */
function jsonOutcome(res: Response, text: string, language: Lang): SendResult {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // Proxy/CDN error pages and platform timeouts come back as HTML or plain text.
    return { ok: false, error: clientError(res.status === 504 || res.status === 408 ? "CLIENT_TIMEOUT" : "CLIENT_BAD_RESPONSE", language) };
  }
  const b = body as { ok?: unknown; answer?: unknown; error?: { code?: unknown; message?: unknown; retryable?: unknown } };
  if (res.ok && b?.ok === true && typeof b.answer === "string" && b.answer.trim()) return { ok: true, answer: b.answer };

  if (b?.ok === false && typeof b.error?.code === "string" && typeof b.error?.message === "string") {
    const retryAfter = Number(res.headers.get("retry-after"));
    const retryAt = Number.isFinite(retryAfter) && retryAfter > 0 ? Date.now() + Math.min(retryAfter, 120) * 1000 : undefined;
    return {
      ok: false,
      error: { code: b.error.code, message: b.error.message, retryable: b.error.retryable === true, ...(retryAt ? { retryAt } : {}) },
    };
  }
  return { ok: false, error: clientError("CLIENT_BAD_RESPONSE", language) };
}

/** Non-streaming request. Never throws: every failure becomes a MessageError. */
export async function sendChat({ message, language, threadId, history, signal, timeoutMs = CLIENT_TIMEOUT_MS }: SendArgs): Promise<SendResult> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const why = (): string => (signal?.aborted ? "CLIENT_ABORTED" : timeout.aborted ? "CLIENT_TIMEOUT" : isOffline() ? "CLIENT_OFFLINE" : "CLIENT_NETWORK");

  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": language },
      body: JSON.stringify({ message, language, threadId, history }),
      signal: combined,
      cache: "no-store",
    });
  } catch {
    return { ok: false, error: clientError(why(), language) };
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { ok: false, error: clientError(why() === "CLIENT_OFFLINE" ? "CLIENT_NETWORK" : why(), language) };
  }
  return jsonOutcome(res, text, language);
}

// ---------------------------------------------------------------- streaming

export interface StreamHandlers {
  onDelta(text: string): void;
  /** Whatever was streamed so far is not part of the answer; clear it. */
  onReset(): void;
  onStatus(phase: string): void;
}

interface SseEvent {
  event: string;
  data: unknown;
}

function parseFrame(frame: string): SseEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (!line || line.startsWith(":")) continue; // heartbeat/comment
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (!data.length) return null;
  try {
    return { event, data: JSON.parse(data.join("\n")) };
  } catch {
    return null;
  }
}

/**
 * Streaming request over Server-Sent Events. Never throws.
 * Resolves with the authoritative final answer (from the `done` event), or a MessageError.
 * Pre-stream rejections (validation, rate limit) arrive as plain JSON and are handled like sendChat.
 */
export async function streamChat(
  args: SendArgs & { handlers: StreamHandlers; idleMs?: number; totalMs?: number },
): Promise<SendResult> {
  const { message, language, threadId, history, signal, handlers, idleMs = STREAM_IDLE_MS, totalMs = STREAM_TOTAL_MS } = args;
  const fail = (code: string): SendResult => ({ ok: false, error: clientError(code, language) });
  if (signal?.aborted) return fail("CLIENT_ABORTED");

  const ctl = new AbortController();
  let reason: "user" | "timeout" | null = null;
  const onUserAbort = () => { reason ??= "user"; ctl.abort(); };
  signal?.addEventListener("abort", onUserAbort, { once: true });
  const timeoutAbort = () => { reason ??= "timeout"; ctl.abort(); };
  let idle: ReturnType<typeof setTimeout> | undefined;
  const bump = () => { clearTimeout(idle); idle = setTimeout(timeoutAbort, idleMs); };
  const total = setTimeout(timeoutAbort, totalMs);
  const abortCode = () => (reason === "user" ? "CLIENT_ABORTED" : reason === "timeout" ? "CLIENT_TIMEOUT" : isOffline() ? "CLIENT_OFFLINE" : "CLIENT_NETWORK");

  try {
    bump();
    let res: Response;
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", "accept-language": language },
        body: JSON.stringify({ message, language, threadId, history, stream: true }),
        signal: ctl.signal,
        cache: "no-store",
      });
    } catch {
      return fail(abortCode());
    }

    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("text/event-stream") || !res.body) {
      let text: string;
      try { text = await res.text(); } catch { return fail(abortCode() === "CLIENT_OFFLINE" ? "CLIENT_NETWORK" : abortCode()); }
      return jsonOutcome(res, text, language);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer: string | null = null;
    let streamError: MessageError | null = null;

    const handle = (ev: SseEvent) => {
      const d = ev.data as Record<string, unknown>;
      if (ev.event === "delta" && typeof d.text === "string") handlers.onDelta(d.text);
      else if (ev.event === "reset") handlers.onReset();
      else if (ev.event === "status" && typeof d.phase === "string") handlers.onStatus(d.phase);
      else if (ev.event === "done" && typeof d.answer === "string") answer = d.answer;
      else if (ev.event === "error" && typeof d.code === "string" && typeof d.message === "string") {
        streamError = { code: d.code, message: d.message, retryable: d.retryable === true };
      }
    };

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bump();
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
        let i: number;
        while ((i = buffer.indexOf("\n\n")) !== -1) {
          const parsed = parseFrame(buffer.slice(0, i));
          buffer = buffer.slice(i + 2);
          if (parsed) handle(parsed);
        }
      }
    } catch {
      return fail(abortCode());
    }

    if (streamError) return { ok: false, error: streamError };
    if (typeof answer === "string" && (answer as string).trim()) return { ok: true, answer: answer as string };
    // The connection closed without `done` or `error`: the answer is incomplete, so never present it as final.
    return fail(isOffline() ? "CLIENT_OFFLINE" : "CLIENT_STREAM_INTERRUPTED");
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
    signal?.removeEventListener("abort", onUserAbort);
  }
}

export type Health = "online" | "degraded" | "offline";

export async function checkHealth(timeoutMs = 8000): Promise<Health> {
  if (isOffline()) return "offline";
  try {
    const res = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? "online" : "degraded";
  } catch {
    return isOffline() ? "offline" : "degraded";
  }
}
