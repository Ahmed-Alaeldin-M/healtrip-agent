import { randomUUID } from "node:crypto";
import { runAgent, streamAgent } from "@/lib/agent";
import { AppError, classifyError, describeError, type Lang } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { parseChatRequest, type ChatRequest } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HEARTBEAT_MS = 15_000;

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "unknown";
}

function langFromHeader(req: Request): Lang {
  return /^ar\b/i.test(req.headers.get("accept-language") ?? "") ? "ar" : "en";
}

function errorResponse(err: unknown, lang: Lang, requestId: string): Response {
  const e = classifyError(err);
  // Full detail goes to logs only; the client gets a code plus a safe localized message.
  console.error(`[chat ${requestId}]`, describeError(err));
  const headers: Record<string, string> = { "x-request-id": requestId };
  if (e.retryAfterSec) headers["retry-after"] = String(e.retryAfterSec);
  return Response.json(
    { ok: false, error: { code: e.code, message: e.userMessage(lang), retryable: e.retryable }, requestId },
    { status: e.status, headers },
  );
}

const encoder = new TextEncoder();
const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * Server-sent events. Everything that can be rejected up front (bad JSON, validation, rate limit) has already
 * been returned as a normal JSON error with a real HTTP status before we get here. Failures after this point
 * are delivered as an `error` event, because the 200 status line is already on the wire.
 */
function streamResponse(body: ChatRequest, req: Request, requestId: string): Response {
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(frame(event, data));
        } catch {
          closed = true;
          abort.abort(); // the client is gone: stop paying for tokens
        }
      };
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
          abort.abort();
        }
      }, HEARTBEAT_MS);

      void (async () => {
        send("start", { requestId });
        try {
          for await (const ev of streamAgent({ message: body.message, history: body.history, lang: body.lang, signal: abort.signal })) {
            send(ev.type, ev.type === "done" ? { answer: ev.answer, requestId } : ev);
          }
          console.info(`[chat ${requestId}] streamed in ${Date.now() - started}ms`);
        } catch (err) {
          const e = classifyError(err);
          console.error(`[chat ${requestId}]`, describeError(err));
          send("error", { code: e.code, message: e.userMessage(body.lang), retryable: e.retryable, requestId });
        } finally {
          clearInterval(heartbeat);
          if (!closed) {
            closed = true;
            try { controller.close(); } catch { /* already closed */ }
          }
        }
      })();
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "content-encoding": "none", // stop Next's gzip layer from buffering tokens
      "x-accel-buffering": "no", // same for nginx
      "x-request-id": requestId,
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const requestId = randomUUID();
  let lang: Lang = langFromHeader(req);
  try {
    checkRateLimit(clientKey(req));
    const body = await parseChatRequest(req);
    lang = body.lang;

    if (body.stream) return streamResponse(body, req, requestId);

    const answer = await runAgent({ message: body.message, history: body.history, lang, signal: req.signal });
    return Response.json({ ok: true, answer, threadId: body.threadId, requestId }, { headers: { "x-request-id": requestId } });
  } catch (err) {
    // Safety net: nothing thrown above may escape as an unhandled 500 with an HTML page.
    try {
      return errorResponse(err, lang, requestId);
    } catch (inner) {
      console.error(`[chat ${requestId}] error handler failed`, inner);
      return new Response(JSON.stringify({ ok: false, error: { code: "INTERNAL", message: new AppError("INTERNAL").userMessage(lang), retryable: true }, requestId }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  }
}

export function GET(): Response {
  return Response.json({ ok: false, error: { code: "INVALID_REQUEST", message: "Use POST." } }, { status: 405, headers: { allow: "POST" } });
}
