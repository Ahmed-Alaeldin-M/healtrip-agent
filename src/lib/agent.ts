import { createAgent, modelFallbackMiddleware, modelRetryMiddleware, modelCallLimitMiddleware, toolErrorMiddleware } from "langchain";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { isAIMessageChunk, type BaseMessage, type BaseMessageChunk } from "@langchain/core/messages";
import { getConfig } from "./config";
import { AppError, classifyError, describeError, type Lang } from "./errors";
import { SYSTEM_PROMPT } from "./prompt";
import { findProviders } from "./tools";
import type { HistoryMessage } from "./request";

type ChatModel = Parameters<typeof createAgent>[0]["model"];
let modelOverride: ChatModel[] | null = null;
/** Test hook: inject fake chat models (first = primary, rest = fallbacks). */
export function __setModelsForTests(models: ChatModel[] | null) {
  modelOverride = models;
  agent = null;
}

function buildModels() {
  if (modelOverride) return modelOverride;
  const cfg = getConfig();
  const models = [];
  // maxRetries is 0 on the clients: retry/fallback is handled once, by the middleware below.
  if (cfg.GOOGLE_API_KEY) {
    models.push(new ChatGoogleGenerativeAI({ model: cfg.GEMINI_MODEL_NAME, temperature: 0, apiKey: cfg.GOOGLE_API_KEY, maxRetries: 0 }));
  }
  if (cfg.GROQ_API_KEY) {
    models.push(new ChatGroq({ model: cfg.GROQ_MODEL_NAME, temperature: 0, apiKey: cfg.GROQ_API_KEY, maxRetries: 0 }));
  }
  return models;
}

const NON_RETRYABLE = new Set(["LLM_AUTH", "LLM_QUOTA", "LLM_CONTENT_BLOCKED", "LLM_CONTEXT_LENGTH", "LLM_BAD_REQUEST", "CLIENT_ABORTED"]);

let agent: ReturnType<typeof buildAgent> | null = null;

function buildAgent() {
  const [primary, ...fallbacks] = buildModels();
  if (!primary) throw new AppError("CONFIG_MISSING_KEYS", { detail: "Set GOOGLE_API_KEY and/or GROQ_API_KEY." });

  return createAgent({
    model: primary,
    tools: [findProviders],
    systemPrompt: SYSTEM_PROMPT,
    middleware: [
      // Hard cap on model calls per run: stops runaway tool loops before the recursion limit.
      modelCallLimitMiddleware({ runLimit: 6, exitBehavior: "error" }),
      // Order matters (first = outermost): fallback wraps retry, so every model is retried on
      // transient errors first, and only then does the next provider get a turn.
      ...(fallbacks.length ? [modelFallbackMiddleware(...fallbacks)] : []),
      modelRetryMiddleware({
        maxRetries: 2,
        initialDelayMs: 500,
        backoffFactor: 2,
        retryOn: (err: Error) => !NON_RETRYABLE.has(classifyError(err).code),
        onFailure: "error",
      }),
      // Last line of defence: a tool that throws becomes an error ToolMessage, not a crashed run.
      toolErrorMiddleware({
        onError: (err) => {
          console.error("[tool] threw", describeError(err));
          return JSON.stringify({ ok: false, providers: [], error: { code: "TOOL_FAILED", retryable: true } });
        },
      }),
    ],
  });
}

function getAgent() {
  agent ??= buildAgent();
  return agent;
}

function extractText(msg: BaseMessage | undefined): string {
  if (!msg) return "";
  const c = msg.content as unknown;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return c
      .map((b) => (typeof b === "string" ? b : b && typeof b === "object" && "text" in b && typeof (b as { text: unknown }).text === "string" ? (b as { text: string }).text : ""))
      .join("")
      .trim();
  }
  return "";
}

function blockedByModel(msg: BaseMessage | undefined): boolean {
  const meta = (msg?.response_metadata ?? {}) as Record<string, unknown>;
  const reason = String(meta.finishReason ?? meta.finish_reason ?? "").toUpperCase();
  return ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "CONTENT_FILTER"].includes(reason);
}

export interface RunOptions {
  message: string;
  history?: HistoryMessage[];
  lang: Lang;
  signal?: AbortSignal;
}

function prepare({ message, history = [], lang, signal }: RunOptions) {
  const cfg = getConfig();
  const instruction = lang === "ar" ? "Respond only in Arabic." : "Respond only in English.";
  const timeout = AbortSignal.timeout(cfg.REQUEST_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const input = {
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: `${message}\n\n(${instruction})` },
    ],
  };
  const mapError = (err: unknown): AppError => {
    if (signal?.aborted) return new AppError("CLIENT_ABORTED", { cause: err });
    if (timeout.aborted) return new AppError("REQUEST_TIMEOUT", { cause: err });
    // modelCallLimit surfaces as a plain error; treat it as the loop limit.
    if (/model call limit|call limit exceeded/i.test(String((err as Error)?.message))) return new AppError("AGENT_LOOP_LIMIT", { cause: err });
    return classifyError(err);
  };
  return { input, combined, mapError };
}

function finalAnswer(messages: BaseMessage[]): string {
  const last = messages.at(-1);
  const text = extractText(last);
  if (!text) throw new AppError(blockedByModel(last) ? "LLM_CONTENT_BLOCKED" : "LLM_EMPTY_RESPONSE");
  return text;
}

export async function runAgent(opts: RunOptions): Promise<string> {
  const { input, combined, mapError } = prepare(opts);
  let result;
  try {
    result = await getAgent().invoke(input, { signal: combined });
  } catch (err) {
    throw mapError(err);
  }
  return finalAnswer((result?.messages ?? []) as BaseMessage[]);
}

export type AgentEvent =
  | { type: "status"; phase: "searching" }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "done"; answer: string };

/** Text of a streamed chunk. Unlike extractText it must not trim: tokens carry their own spaces. */
function chunkText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (typeof b === "string" ? b : b && typeof b === "object" && (b as { type?: string }).type === "text" && typeof (b as { text?: unknown }).text === "string" ? (b as { text: string }).text : ""))
    .join("");
}

/**
 * Streams the agent run as UI-ready events.
 * - delta: a piece of the answer that is currently being written
 * - status/searching: the model decided to call the provider search tool
 * - reset: whatever was streamed so far is not part of the answer (preamble before a tool call); clear it
 * - done: the authoritative final answer, taken from the final graph state (replaces any streamed text)
 * Errors are thrown as AppError after the events already yielded.
 */
export async function* streamAgent(opts: RunOptions): AsyncGenerator<AgentEvent> {
  const { input, combined, mapError } = prepare(opts);
  let finalMessages: BaseMessage[] | null = null;
  try {
    const stream = await getAgent().stream(input, { signal: combined, streamMode: ["messages", "values"] } as never);
    let step: unknown;
    let sawToolCall = false;
    let streamed = "";
    for await (const item of stream as unknown as AsyncIterable<[string, unknown]>) {
      const [mode, payload] = item;
      if (mode === "values") {
        finalMessages = ((payload as { messages?: BaseMessage[] })?.messages ?? null) as BaseMessage[] | null;
        continue;
      }
      if (mode !== "messages") continue;
      const [chunk, meta] = payload as [BaseMessageChunk, { langgraph_step?: unknown } | undefined];
      if (!isAIMessageChunk(chunk)) continue;

      const thisStep = meta?.langgraph_step;
      if (thisStep !== undefined && thisStep !== step) {
        // A new model turn begins. Text from the previous turn was a preamble to a tool call; drop it.
        if (streamed) yield { type: "reset" };
        streamed = "";
        sawToolCall = false;
        step = thisStep;
      }

      if (chunk.tool_call_chunks?.length || chunk.tool_calls?.length) {
        if (!sawToolCall) {
          sawToolCall = true;
          if (streamed) yield { type: "reset" };
          streamed = "";
          yield { type: "status", phase: "searching" };
        }
        continue;
      }
      if (sawToolCall) continue;
      const text = chunkText(chunk.content);
      if (text) {
        streamed += text;
        yield { type: "delta", text };
      }
    }
  } catch (err) {
    throw mapError(err);
  }
  yield { type: "done", answer: finalAnswer(finalMessages ?? []) };
}

export function agentConfigured(): boolean {
  try {
    getAgent();
    return true;
  } catch {
    return false;
  }
}
