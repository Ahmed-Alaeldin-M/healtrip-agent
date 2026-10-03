import test from "node:test";
import assert from "node:assert/strict";
import { BaseChatModel, type BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { __setModelsForTests, runAgent, streamAgent, type AgentEvent } from "../src/lib/agent";
import { __resetIndexForTests } from "../src/lib/vector-store";
import { __setEmbedderForTests } from "../src/lib/embeddings";
import { POST } from "../src/app/api/chat/route";
import fs from "node:fs";

delete process.env.GOOGLE_API_KEY;
delete process.env.GROQ_API_KEY;

type Partial = { tokens: string[]; error: Error };
type Step = (messages: BaseMessage[]) => AIMessage | Error | Partial;

class ScriptedModel extends BaseChatModel {
  calls: BaseMessage[][] = [];
  constructor(private steps: Step[], params: BaseChatModelParams = {}) { super(params); }
  _llmType() { return "scripted"; }
  bindTools() { return this as never; }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls.push(messages);
    const step = this.steps[Math.min(this.calls.length - 1, this.steps.length - 1)]!;
    const out = step(messages);
    if (out instanceof Error) throw out;
    if ("error" in out && "tokens" in out) throw out.error;
    const msg = out as AIMessage;
    return { generations: [{ message: msg, text: String(msg.content) }] };
  }
  // Like the real Gemini/Groq clients, report every token to the callback system; that is what feeds LangGraph's "messages" stream.
  async *_streamResponseChunks(messages: BaseMessage[], _options?: unknown, runManager?: CallbackManagerForLLMRun): AsyncGenerator<ChatGenerationChunk> {
    const emit = async (chunk: ChatGenerationChunk) => {
      await runManager?.handleLLMNewToken(chunk.text, undefined, undefined, undefined, undefined, { chunk });
      return chunk;
    };
    this.calls.push(messages);
    const step = this.steps[Math.min(this.calls.length - 1, this.steps.length - 1)]!;
    const out = step(messages);
    if (out instanceof Error) throw out;
    if ("error" in out && "tokens" in out) {
      for (const t of out.tokens) yield await emit(new ChatGenerationChunk({ message: new AIMessageChunk({ content: t }), text: t }));
      throw out.error;
    }
    const msg = out as AIMessage;
    for (const t of String(msg.content).match(/\S+\s*/g) ?? []) {
      yield await emit(new ChatGenerationChunk({ message: new AIMessageChunk({ content: t }), text: t }));
    }
    if (msg.tool_calls?.length) {
      const tool_call_chunks = msg.tool_calls.map((c, index) => ({ name: c.name, args: JSON.stringify(c.args), id: c.id, index, type: "tool_call_chunk" as const }));
      yield await emit(new ChatGenerationChunk({ message: new AIMessageChunk({ content: "", tool_call_chunks }), text: "" }));
    }
  }
}

const vectors = JSON.parse(fs.readFileSync("data/provider_vectors.json", "utf8"));
const toolCall = (args: Record<string, unknown>) =>
  new AIMessage({ content: "", tool_calls: [{ id: "call_1", name: "find_providers", args, type: "tool_call" }] });

const post = (body: unknown) =>
  POST(new Request("http://x/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

test("agent runs the tool loop and receives the history", async () => {
  __resetIndexForTests();
  __setEmbedderForTests(async () => vectors.items[0].vector);
  const model = new ScriptedModel([
    () => toolCall({ query: "chest pain", specialty: "Cardiology", city: "Riyadh" }),
    (msgs) => {
      const toolMsg = msgs.at(-1)!;
      assert.equal(toolMsg.getType(), "tool");
      assert.match(String(toolMsg.content), /Dr\. Sara Al-Harbi/);
      return new AIMessage("Dr. Sara Al-Harbi in Riyadh is a match.");
    },
  ]);
  __setModelsForTests([model]);
  const answer = await runAgent({
    message: "find a cardiologist",
    lang: "en",
    history: [{ role: "user", content: "I live in Riyadh" }, { role: "assistant", content: "Noted." }],
  });
  assert.equal(answer, "Dr. Sara Al-Harbi in Riyadh is a match.");
  const first = model.calls[0]!.map((m) => `${m.getType()}:${String(m.content)}`);
  assert.ok(first.some((l) => l.startsWith("human:I live in Riyadh")));
  assert.ok(first.some((l) => l.startsWith("ai:Noted.")));
  assert.ok(first.at(-1)!.includes("Respond only in English."));
});

test("a failing tool becomes an error ToolMessage and the agent still answers", async () => {
  const cfg = (await import("../src/lib/config")).getConfig() as { VECTORS_PATH: string };
  const good = cfg.VECTORS_PATH;
  cfg.VECTORS_PATH = "/nonexistent.json";
  __resetIndexForTests();
  const model = new ScriptedModel([
    () => toolCall({ query: "x", specialty: "Cardiology" }),
    (msgs) => {
      assert.match(String(msgs.at(-1)!.content), /INDEX_MISSING/);
      return new AIMessage("Provider lookup is temporarily unavailable.");
    },
  ]);
  __setModelsForTests([model]);
  assert.match(await runAgent({ message: "hi", lang: "en" }), /temporarily unavailable/);
  cfg.VECTORS_PATH = good;
  __resetIndexForTests();
});

test("falls back to the second model when the primary keeps failing", async () => {
  const primary = new ScriptedModel([() => Object.assign(new Error("overloaded"), { status: 503 })]);
  const secondary = new ScriptedModel([() => new AIMessage("from fallback")]);
  __setModelsForTests([primary, secondary]);
  assert.equal(await runAgent({ message: "hi", lang: "en" }), "from fallback");
  assert.ok(primary.calls.length >= 2, `primary tried ${primary.calls.length}x (retry before fallback)`);
});

test("auth errors are not retried and surface as typed errors", async () => {
  const m = new ScriptedModel([() => Object.assign(new Error("bad key"), { status: 401 })]);
  __setModelsForTests([m]);
  await assert.rejects(runAgent({ message: "hi", lang: "en" }), { code: "LLM_AUTH" });
  assert.equal(m.calls.length, 1);
});

test("empty model output is a typed error", async () => {
  __setModelsForTests([new ScriptedModel([() => new AIMessage("")])]);
  await assert.rejects(runAgent({ message: "hi", lang: "en" }), { code: "LLM_EMPTY_RESPONSE" });
});

test("endless tool loop is stopped by the call limit", async () => {
  __setEmbedderForTests(async () => vectors.items[0].vector);
  __setModelsForTests([new ScriptedModel([() => toolCall({ query: "x" })])]);
  await assert.rejects(runAgent({ message: "hi", lang: "en" }), { code: "AGENT_LOOP_LIMIT" });
});

test("route: full request with history returns the answer", async () => {
  __setModelsForTests([new ScriptedModel([() => new AIMessage("ok answer")])]);
  const r = await post({ message: "hello", language: "en", history: [{ role: "assistant", content: "leading" }, { role: "user", content: "u" }, { role: "assistant", content: "a" }] });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.answer, "ok answer");
});

test("route: model failure returns a typed localized error", async () => {
  __setModelsForTests([new ScriptedModel([() => Object.assign(new Error("quota"), { status: 429 })])]);
  const r = await post({ message: "hello", language: "ar" });
  const j = await r.json();
  assert.equal(r.status, 429);
  assert.equal(j.error.code, "LLM_RATE_LIMIT");
  assert.equal(j.error.retryable, true);
  assert.match(j.error.message, /[\u0600-\u06FF]/);
});

async function collect(gen: AsyncGenerator<AgentEvent>) {
  const events: AgentEvent[] = [];
  try { for await (const e of gen) events.push(e); } catch (error) { return { events, error: error as { code?: string } }; }
  return { events, error: undefined };
}

test("stream: tokens arrive incrementally and the final answer is authoritative", async () => {
  __setModelsForTests([new ScriptedModel([() => new AIMessage("Please see a doctor today.")])]);
  const { events, error } = await collect(streamAgent({ message: "hi", lang: "en" }));
  assert.equal(error, undefined);
  const deltas = events.filter((e) => e.type === "delta") as { text: string }[];
  assert.ok(deltas.length >= 4, `expected several deltas, got ${deltas.length}`);
  assert.equal(deltas.map((d) => d.text).join(""), "Please see a doctor today.");
  assert.equal(events.at(-1)?.type, "done");
  assert.equal((events.at(-1) as { answer: string }).answer, "Please see a doctor today.");
  assert.ok(!events.some((e) => e.type === "reset" || e.type === "status"));
});

test("stream: preamble before a tool call is reset, status is emitted, then the real answer streams", async () => {
  __resetIndexForTests();
  __setEmbedderForTests(async () => vectors.items[0].vector);
  const pre = new AIMessage({ content: "Let me check the database.", tool_calls: [{ id: "c1", name: "find_providers", args: { query: "chest pain", specialty: "قلب", city: "الرياض" }, type: "tool_call" }] });
  __setModelsForTests([new ScriptedModel([() => pre, (msgs) => {
    assert.match(String(msgs.at(-1)!.content), /Riyadh/, "tool received the normalized English filters");
    return new AIMessage("Dr. Sara Al-Harbi matches.");
  }])]);
  const { events, error } = await collect(streamAgent({ message: "find", lang: "ar" }));
  assert.equal(error, undefined);
  const kinds = events.map((e) => e.type);
  assert.ok(kinds.indexOf("reset") > kinds.indexOf("delta"), "preamble streamed first, then discarded");
  assert.ok(kinds.includes("status"));
  const afterReset = events.slice(kinds.indexOf("reset") + 1).filter((e) => e.type === "delta") as { text: string }[];
  assert.equal(afterReset.map((d) => d.text).join(""), "Dr. Sara Al-Harbi matches.");
  assert.equal((events.at(-1) as { answer: string }).answer, "Dr. Sara Al-Harbi matches.");
});

test("stream: failures surface as typed errors, with or without partial output", async () => {
  __setModelsForTests([new ScriptedModel([() => Object.assign(new Error("bad key"), { status: 401 })])]);
  assert.equal((await collect(streamAgent({ message: "hi", lang: "en" }))).error?.code, "LLM_AUTH");

  __setModelsForTests([new ScriptedModel([() => ({ tokens: ["Partial ", "answer "], error: Object.assign(new Error("bad key"), { status: 401 }) })])]);
  const r = await collect(streamAgent({ message: "hi", lang: "en" }));
  assert.equal(r.error?.code, "LLM_AUTH");
  assert.ok(r.events.some((e) => e.type === "delta"), "partial text was already sent; the route follows it with an error event");
  assert.ok(!r.events.some((e) => e.type === "done"));

  __setModelsForTests([new ScriptedModel([() => new AIMessage("")])]);
  assert.equal((await collect(streamAgent({ message: "hi", lang: "en" }))).error?.code, "LLM_EMPTY_RESPONSE");
});

test("stream: client abort stops the run with CLIENT_ABORTED", async () => {
  __setModelsForTests([new ScriptedModel([() => new AIMessage("a b c d e f g")])]);
  const ac = new AbortController();
  ac.abort();
  assert.equal((await collect(streamAgent({ message: "hi", lang: "en", signal: ac.signal }))).error?.code, "CLIENT_ABORTED");
});

async function sse(res: Response) {
  const text = await res.text();
  return text.split("\n\n").filter((f) => f.startsWith("event:")).map((f) => {
    const [e, d] = f.split("\n");
    return { event: e!.slice(7), data: JSON.parse(d!.slice(6)) };
  });
}

test("route: stream=true returns an SSE stream that ends with done", async () => {
  __setModelsForTests([new ScriptedModel([() => new AIMessage("one two three four")])]);
  const res = await post({ message: "hello", language: "en", stream: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /text\/event-stream/);
  assert.equal(res.headers.get("content-encoding"), "none");
  const events = await sse(res);
  assert.equal(events[0]!.event, "start");
  assert.equal(events.filter((e) => e.event === "delta").map((e) => e.data.text).join(""), "one two three four");
  assert.equal(events.at(-1)!.event, "done");
  assert.equal(events.at(-1)!.data.answer, "one two three four");
});

test("route: errors before streaming are plain JSON with a real status; errors during streaming are error events", async () => {
  const bad = await post({ message: "   ", stream: true });
  assert.equal(bad.status, 400);
  assert.match(bad.headers.get("content-type")!, /json/);

  __setModelsForTests([new ScriptedModel([() => ({ tokens: ["Partial "], error: Object.assign(new Error("429"), { status: 429 }) })])]);
  const res = await post({ message: "hello", language: "ar", stream: true });
  assert.equal(res.status, 200);
  const events = await sse(res);
  const err = events.find((e) => e.event === "error")!;
  assert.equal(err.data.code, "LLM_RATE_LIMIT");
  assert.equal(err.data.retryable, true);
  assert.match(err.data.message, /[\u0600-\u06FF]/);
  assert.ok(!events.some((e) => e.event === "done"));
});

test("route: cancelling the response stream mid-flight does not crash the server", async () => {
  __setModelsForTests([new ScriptedModel([() => new AIMessage("x ".repeat(200))])]);
  const res = await post({ message: "hello", stream: true });
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();
  await new Promise((r) => setTimeout(r, 50));
});
