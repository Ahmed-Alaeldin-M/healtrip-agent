import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "./errors";

export const MAX_BODY_BYTES = 128 * 1024;
export const MAX_MESSAGE_CHARS = 2000;
export const HISTORY_MAX_MESSAGES = 12;
export const HISTORY_ITEM_MAX_CHARS = 3000;

const historyItem = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const bodySchema = z.object({
  message: z.string(),
  language: z.enum(["en", "ar"]).default("en"),
  threadId: z.string().uuid().optional(),
  history: z.array(historyItem).max(100).default([]),
  stream: z.boolean().default(false),
});

export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  message: string;
  lang: "en" | "ar";
  threadId: string;
  history: HistoryMessage[];
  stream: boolean;
}

/**
 * The client owns conversation memory and sends it with each request, so the server stays
 * stateless (survives restarts, multiple instances, and failed runs). This makes the history
 * safe for every provider: trimmed, alternating, starting with a user turn, ending with an assistant turn.
 */
export function normalizeHistory(items: HistoryMessage[]): HistoryMessage[] {
  const cleaned: HistoryMessage[] = [];
  for (const item of items) {
    const content = item.content.trim().slice(0, HISTORY_ITEM_MAX_CHARS);
    if (!content) continue;
    const prev = cleaned.at(-1);
    if (prev && prev.role === item.role) prev.content = `${prev.content}\n${content}`.slice(0, HISTORY_ITEM_MAX_CHARS);
    else cleaned.push({ role: item.role, content });
  }
  let out = cleaned.slice(-HISTORY_MAX_MESSAGES);
  while (out[0]?.role === "assistant") out = out.slice(1);
  while (out.at(-1)?.role === "user") out = out.slice(0, -1);
  return out;
}

export async function parseChatRequest(req: Request): Promise<ChatRequest> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    throw new AppError("INVALID_REQUEST", { detail: "Content-Type must be application/json." });
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new AppError("PAYLOAD_TOO_LARGE");

  let text: string;
  try {
    text = await req.text();
  } catch (err) {
    throw new AppError("INVALID_REQUEST", { cause: err, detail: "Could not read request body." });
  }
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new AppError("PAYLOAD_TOO_LARGE");

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new AppError("INVALID_JSON", { cause: err });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError("INVALID_REQUEST", { detail: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  const message = parsed.data.message.trim();
  if (!message) throw new AppError("INVALID_REQUEST", { detail: "message must not be empty." });
  if (message.length > MAX_MESSAGE_CHARS) throw new AppError("MESSAGE_TOO_LONG");

  return {
    message,
    lang: parsed.data.language,
    threadId: parsed.data.threadId ?? randomUUID(),
    history: normalizeHistory(parsed.data.history),
    stream: parsed.data.stream,
  };
}
