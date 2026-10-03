import test from "node:test";
import assert from "node:assert/strict";
import { reducer, buildHistory, emptyConversation, canSend, isPending } from "../src/lib/chat/reducer";
import { parseStored, saveConversations, serialize, STORAGE_KEY } from "../src/lib/chat/storage";
import { sendChat, streamChat } from "../src/lib/chat/client";
import { MAX_MESSAGES_PER_CHAT, type ChatMessage, type ChatState, type Conversation } from "../src/lib/chat/types";

const msg = (id: string, role: "user" | "assistant", content: string, status: ChatMessage["status"] = "done", t = 1): ChatMessage => ({ id, role, content, createdAt: t, status });
const base = (): ChatState => reducer({ conversations: [], activeId: "", hydrated: false }, { type: "hydrate", conversations: [], newId: "c0", now: 1 });

test("hydrate starts on a blank chat and keeps stored history", () => {
  const stored: Conversation = { ...emptyConversation("old", 5), messages: [msg("m1", "user", "hi"), msg("m2", "assistant", "hello")], updatedAt: 5 };
  const s = reducer({ conversations: [], activeId: "", hydrated: false }, { type: "hydrate", conversations: [stored], newId: "fresh", now: 9 });
  assert.equal(s.activeId, "fresh");
  assert.equal(s.conversations.length, 2);
  const kept = reducer({ conversations: [], activeId: "", hydrated: false }, { type: "hydrate", conversations: [stored], activeId: "old", newId: "x", now: 9 });
  assert.equal(kept.activeId, "old");
});

test("send -> succeed appends the reply and titles the chat from the first message", () => {
  let s = base();
  s = reducer(s, { type: "send", convId: "c0", message: msg("u1", "user", "I have chest pain since yesterday and it spreads to my arm", "pending", 2) });
  assert.equal(isPending(s.conversations[0]), true);
  assert.equal(s.conversations[0]!.title, "I have chest pain since yesterday and it…");
  s = reducer(s, { type: "succeed", convId: "c0", userId: "u1", reply: msg("a1", "assistant", "Seek emergency care.", "done", 3) });
  const c = s.conversations[0]!;
  assert.deepEqual(c.messages.map((m) => m.status), ["done", "done"]);
  assert.equal(canSend(c), true);
});

test("a second send is blocked while one is in flight", () => {
  let s = reducer(base(), { type: "send", convId: "c0", message: msg("u1", "user", "a", "pending") });
  s = reducer(s, { type: "send", convId: "c0", message: msg("u2", "user", "b", "pending") });
  assert.equal(s.conversations[0]!.messages.length, 1);
});

test("a reply that lands after its chat was deleted is ignored; one that lands after switching goes to the right chat", () => {
  let s = reducer(base(), { type: "send", convId: "c0", message: msg("u1", "user", "first", "pending", 2) });
  s = reducer(s, { type: "new", id: "c1", now: 3 });
  assert.equal(s.activeId, "c1");
  s = reducer(s, { type: "succeed", convId: "c0", userId: "u1", reply: msg("a1", "assistant", "reply for c0", "done", 4) });
  assert.equal(s.conversations.find((c) => c.id === "c0")!.messages.length, 2);
  assert.equal(s.conversations.find((c) => c.id === "c1")!.messages.length, 0);
  const deleted = reducer(s, { type: "delete", id: "c0", newId: "n", now: 5 });
  const after = reducer(deleted, { type: "succeed", convId: "c0", userId: "u1", reply: msg("a2", "assistant", "late", "done", 6) });
  assert.equal(after, deleted);
});

test("fail -> retry -> succeed; retry only works on the last failed user message", () => {
  let s = reducer(base(), { type: "send", convId: "c0", message: msg("u1", "user", "q", "pending") });
  s = reducer(s, { type: "fail", convId: "c0", userId: "u1", error: { code: "LLM_TIMEOUT", message: "slow", retryable: true } });
  assert.equal(s.conversations[0]!.messages[0]!.status, "error");
  assert.equal(canSend(s.conversations[0]), true);
  s = reducer(s, { type: "retry", convId: "c0", userId: "u1" });
  assert.equal(s.conversations[0]!.messages[0]!.status, "pending");
  s = reducer(s, { type: "succeed", convId: "c0", userId: "u1", reply: msg("a1", "assistant", "ok") });
  assert.equal(s.conversations[0]!.messages.length, 2);
  assert.equal(reducer(s, { type: "retry", convId: "c0", userId: "u1" }), s);
});

test("history only contains completed turns, in strict alternation", () => {
  const conv: Conversation = {
    ...emptyConversation("c", 1),
    messages: [
      msg("1", "user", "q1"), msg("2", "assistant", "a1"),
      msg("3", "user", "failed q", "error"),
      msg("4", "user", "q2"), msg("5", "assistant", "a2"),
      msg("6", "user", "current", "pending"),
    ],
  };
  assert.deepEqual(buildHistory(conv, "6").map((m) => m.content), ["q1", "a1", "q2", "a2"]);
  assert.deepEqual(buildHistory(conv, "3").map((m) => m.content), ["q1", "a1"]);
});

test("chat size cap blocks sending", () => {
  const messages = Array.from({ length: MAX_MESSAGES_PER_CHAT }, (_, i) => msg(`m${i}`, i % 2 ? "assistant" : "user", "x"));
  const full: Conversation = { ...emptyConversation("f", 1), messages };
  assert.equal(canSend(full), false);
});

test("new chat reuses the blank one; delete of the active chat falls back to the most recent", () => {
  let s = base();
  assert.equal(reducer(s, { type: "new", id: "zzz", now: 2 }), s);
  s = reducer(s, { type: "send", convId: "c0", message: msg("u1", "user", "one", "done", 2) });
  s = reducer(s, { type: "new", id: "c1", now: 3 });
  s = reducer(s, { type: "send", convId: "c1", message: msg("u2", "user", "two", "done", 4) });
  s = reducer(s, { type: "delete", id: "c1", newId: "n", now: 5 });
  assert.equal(s.activeId, "c0");
  s = reducer(s, { type: "delete", id: "c0", newId: "n2", now: 6 });
  assert.equal(s.activeId, "n2");
  assert.equal(s.conversations.length, 1);
});

test("rename: user title sticks; empty rename reverts to the auto title", () => {
  let s = reducer(base(), { type: "send", convId: "c0", message: msg("u1", "user", "hello there", "done") });
  s = reducer(s, { type: "rename", id: "c0", title: "  My   plan " });
  assert.equal(s.conversations[0]!.title, "My plan");
  assert.equal(s.conversations[0]!.titleSource, "user");
  s = reducer(s, { type: "rename", id: "c0", title: "   " });
  assert.equal(s.conversations[0]!.title, "hello there");
});

test("sync from another tab keeps local in-flight chats and removes remotely deleted ones", () => {
  let s = reducer(base(), { type: "send", convId: "c0", message: msg("u1", "user", "local", "pending", 2) });
  const remote: Conversation = { ...emptyConversation("r1", 3), messages: [msg("x", "user", "remote"), msg("y", "assistant", "yes")], updatedAt: 3 };
  s = reducer(s, { type: "sync", conversations: [remote], newId: "n", now: 4 });
  assert.deepEqual(s.conversations.map((c) => c.id).sort(), ["c0", "r1"]);
  assert.equal(isPending(s.conversations.find((c) => c.id === "c0")), true);
  s = reducer(s, { type: "sync", conversations: [], newId: "n", now: 5 });
  assert.deepEqual(s.conversations.map((c) => c.id), ["c0"]);
});

test("storage: round-trip, pending becomes interrupted, corrupt data is survivable", () => {
  const conv: Conversation = { ...emptyConversation("c", 1), messages: [msg("1", "user", "hi", "pending")], updatedAt: 5 };
  const raw = serialize([conv, emptyConversation("blank", 2)]);
  const { conversations, corrupt } = parseStored(raw);
  assert.equal(corrupt, false);
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0]!.messages[0]!.status, "error");
  assert.equal(conversations[0]!.messages[0]!.error!.code, "INTERRUPTED");

  assert.equal(parseStored("{nope").corrupt, true);
  assert.equal(parseStored('{"conversations":"x"}').corrupt, true);
  assert.deepEqual(parseStored(null), { conversations: [], corrupt: false });

  const partial = JSON.stringify({ conversations: [
    { id: "ok", title: "t", titleSource: "auto", createdAt: 1, updatedAt: 2, messages: [{ id: "m", role: "user", content: "x", createdAt: 1, status: "done" }, { bogus: true }] },
    { nope: 1 },
    { id: "ok", title: "dupe", createdAt: 1, updatedAt: 2, messages: [] },
  ] });
  const p = parseStored(partial);
  assert.equal(p.conversations.length, 1);
  assert.equal(p.conversations[0]!.messages.length, 1);
  assert.equal(p.corrupt, false);
});

test("storage: quota errors prune the oldest chats and retry; total failure never throws", () => {
  const mk = (id: string, t: number): Conversation => ({ ...emptyConversation(id, t), messages: [msg(id + "m", "user", "x".repeat(50))], updatedAt: t });
  const list = [mk("a", 1), mk("b", 2), mk("c", 3), mk("d", 4)];
  const fake = (limit: number) => {
    const store = new Map<string, string>();
    return { store, getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k), setItem(k: string, v: string) { if (v.length > limit) throw new DOMException("full", "QuotaExceededError"); store.set(k, v); } };
  };
  const s = fake(serialize(list.slice(2)).length + 5);
  const r = saveConversations(s, list);
  assert.equal(r.ok, true);
  assert.equal(r.pruned, true);
  assert.deepEqual(parseStored(s.store.get(STORAGE_KEY)!).conversations.map((c) => c.id).sort(), ["c", "d"]);
  assert.equal(saveConversations(fake(10), list).ok, false);
  assert.equal(saveConversations(null, list).ok, false);
});

const withFetch = async (impl: typeof fetch, fn: () => Promise<void>) => {
  const orig = globalThis.fetch;
  globalThis.fetch = impl;
  try { await fn(); } finally { globalThis.fetch = orig; }
};
const args = { message: "hi", language: "en" as const, threadId: "t", history: [] };

test("client: success, typed server error with Retry-After, html error page, bad json, network, timeout, abort", async () => {
  await withFetch(async () => Response.json({ ok: true, answer: "hello" }), async () => {
    assert.deepEqual(await sendChat(args), { ok: true, answer: "hello" });
  });
  await withFetch(async () => Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "slow down", retryable: true } }, { status: 429, headers: { "retry-after": "7" } }), async () => {
    const r = await sendChat(args);
    assert.ok(!r.ok && r.error.code === "RATE_LIMITED" && r.error.retryable && r.error.retryAt! > Date.now());
  });
  await withFetch(async () => new Response("<html>502</html>", { status: 502 }), async () => {
    const r = await sendChat(args);
    assert.ok(!r.ok && r.error.code === "CLIENT_BAD_RESPONSE");
  });
  await withFetch(async () => new Response("gateway timeout", { status: 504 }), async () => {
    const r = await sendChat(args);
    assert.ok(!r.ok && r.error.code === "CLIENT_TIMEOUT");
  });
  await withFetch(async () => Response.json({ weird: true }), async () => {
    const r = await sendChat(args);
    assert.ok(!r.ok && r.error.code === "CLIENT_BAD_RESPONSE");
  });
  await withFetch(async () => Response.json({ ok: true, answer: "   " }), async () => {
    const r = await sendChat(args);
    assert.ok(!r.ok && r.error.code === "CLIENT_BAD_RESPONSE");
  });
  await withFetch(async () => { throw new TypeError("Failed to fetch"); }, async () => {
    const r = await sendChat(args);
    assert.ok(!r.ok && r.error.code === "CLIENT_NETWORK");
  });
  const hang: typeof fetch = (_u, init) => new Promise((_res, rej) => init!.signal!.addEventListener("abort", () => rej(init!.signal!.reason)));
  // Node's AbortSignal.timeout timer is unref'd, so keep the event loop alive while the test waits on it.
  const keepAlive = setTimeout(() => {}, 5000);
  await withFetch(hang, async () => {
    const r = await sendChat({ ...args, timeoutMs: 30 });
    assert.ok(!r.ok && r.error.code === "CLIENT_TIMEOUT");
    const ac = new AbortController();
    const p = sendChat({ ...args, signal: ac.signal });
    ac.abort();
    const r2 = await p;
    assert.ok(!r2.ok && r2.error.code === "CLIENT_ABORTED");
  });
  clearTimeout(keepAlive);
});

test("reducer: streamed partial is upserted, reset clears it, succeed finalizes the same message, fail discards it", () => {
  let s = reducer(base(), { type: "send", convId: "c0", message: msg("u1", "user", "q", "pending", 2) });
  s = reducer(s, { type: "stream", convId: "c0", userId: "u1", assistantId: "a1", content: "Hel", now: 3 });
  s = reducer(s, { type: "stream", convId: "c0", userId: "u1", assistantId: "a1", content: "Hello wor", now: 4 });
  let c = s.conversations[0]!;
  assert.equal(c.messages.length, 2);
  assert.deepEqual([c.messages[1]!.status, c.messages[1]!.content], ["streaming", "Hello wor"]);
  assert.equal(isPending(c), true);

  const reset = reducer(s, { type: "stream", convId: "c0", userId: "u1", assistantId: "a1", content: "", now: 5 });
  assert.equal(reset.conversations[0]!.messages.length, 1);

  const done = reducer(s, { type: "succeed", convId: "c0", userId: "u1", reply: msg("a1", "assistant", "Hello world.", "done", 6) });
  c = done.conversations[0]!;
  assert.deepEqual(c.messages.map((m) => [m.status, m.content]), [["done", "q"], ["done", "Hello world."]]);

  const failed = reducer(s, { type: "fail", convId: "c0", userId: "u1", error: { code: "X", message: "m", retryable: true } });
  assert.deepEqual(failed.conversations[0]!.messages.map((m) => m.status), ["error"]);

  // late tokens for a finished or deleted turn are ignored
  assert.equal(reducer(done, { type: "stream", convId: "c0", userId: "u1", assistantId: "zz", content: "late", now: 9 }), done);
});

test("storage: a half-streamed answer is never persisted or restored", () => {
  const conv: Conversation = { ...emptyConversation("c", 1), updatedAt: 5, messages: [msg("u", "user", "q", "pending"), msg("a", "assistant", "half an ans", "streaming")] };
  const stored = parseStored(serialize([conv])).conversations[0]!;
  assert.deepEqual(stored.messages.map((m) => m.id), ["u"]);
  assert.equal(stored.messages[0]!.status, "error");
  const raw = JSON.stringify({ conversations: [{ ...conv, messages: conv.messages }] });
  assert.deepEqual(parseStored(raw).conversations[0]!.messages.map((m) => m.id), ["u"]);
});

const enc = new TextEncoder();
function sseResponse(chunks: string[], opts: { hang?: boolean; status?: number } = {}) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      if (!opts.hang) c.close();
    },
  });
  return { res: new Response(body, { status: opts.status ?? 200, headers: { "content-type": "text/event-stream" } }), controller: () => controller };
}
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const handlersOf = () => {
  const log: string[] = [];
  return { log, handlers: { onDelta: (t: string) => log.push(`d:${t}`), onReset: () => log.push("reset"), onStatus: (p: string) => log.push(`s:${p}`) } };
};

test("streamChat: parses frames split across chunks, CRLF, heartbeats; done is authoritative", async () => {
  const text = frame("start", { requestId: "r" }) + ": ping\n\n" + frame("delta", { type: "delta", text: "Hel" }) + frame("delta", { type: "delta", text: "lo" }) + frame("done", { answer: "Hello!" });
  // cut the byte stream at awkward places, including in the middle of a frame and between \r and \n
  const crlf = text.replace(/\n/g, "\r\n");
  const cuts = [7, 31, 44, 90, crlf.length - 5];
  const parts: string[] = [];
  let from = 0;
  for (const c of cuts) { parts.push(crlf.slice(from, c)); from = c; }
  parts.push(crlf.slice(from));
  const { res } = sseResponse(parts);
  const { log, handlers } = handlersOf();
  await withFetch(async () => res, async () => {
    const r = await streamChat({ ...args, handlers });
    assert.deepEqual(r, { ok: true, answer: "Hello!" });
    assert.deepEqual(log, ["d:Hel", "d:lo"]);
  });
});

test("streamChat: reset/status events, error events, and pre-stream JSON errors", async () => {
  const a = sseResponse([frame("delta", { text: "Let me check" }), frame("reset", {}), frame("status", { phase: "searching" }), frame("delta", { text: "Answer" }), frame("done", { answer: "Answer" })]);
  const h1 = handlersOf();
  await withFetch(async () => a.res, async () => {
    assert.deepEqual(await streamChat({ ...args, handlers: h1.handlers }), { ok: true, answer: "Answer" });
    assert.deepEqual(h1.log, ["d:Let me check", "reset", "s:searching", "d:Answer"]);
  });

  const b = sseResponse([frame("delta", { text: "Par" }), frame("error", { code: "LLM_OVERLOADED", message: "Busy", retryable: true })]);
  await withFetch(async () => b.res, async () => {
    const r = await streamChat({ ...args, handlers: handlersOf().handlers });
    assert.ok(!r.ok && r.error.code === "LLM_OVERLOADED" && r.error.retryable);
  });

  await withFetch(async () => Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "Slow down", retryable: true } }, { status: 429, headers: { "retry-after": "9" } }), async () => {
    const r = await streamChat({ ...args, handlers: handlersOf().handlers });
    assert.ok(!r.ok && r.error.code === "RATE_LIMITED" && r.error.retryAt! > Date.now());
  });

  await withFetch(async () => new Response("<html>502</html>", { status: 502 }), async () => {
    const r = await streamChat({ ...args, handlers: handlersOf().handlers });
    assert.ok(!r.ok && r.error.code === "CLIENT_BAD_RESPONSE");
  });
});

test("streamChat: a stream that ends without done is an error, never a final answer", async () => {
  const a = sseResponse([frame("delta", { text: "Half an answ" })]);
  await withFetch(async () => a.res, async () => {
    const r = await streamChat({ ...args, handlers: handlersOf().handlers });
    assert.ok(!r.ok && r.error.code === "CLIENT_STREAM_INTERRUPTED" && r.error.retryable);
  });
});

test("streamChat: idle timeout, user abort mid-stream, and network failure", async () => {
  const keepAlive = setTimeout(() => {}, 5000);
  const hangFetch = (hang: ReturnType<typeof sseResponse>): typeof fetch => async (_u, init) => {
    init!.signal!.addEventListener("abort", () => hang.controller().error(init!.signal!.reason));
    return hang.res;
  };
  const idleHang = sseResponse([frame("delta", { text: "x" })], { hang: true });
  await withFetch(hangFetch(idleHang), async () => {
    const r = await streamChat({ ...args, handlers: handlersOf().handlers, idleMs: 40 });
    assert.ok(!r.ok && r.error.code === "CLIENT_TIMEOUT");
  });
  const userHang = sseResponse([frame("delta", { text: "x" })], { hang: true });
  await withFetch(hangFetch(userHang), async () => {
    const ac = new AbortController();
    const p = streamChat({ ...args, handlers: { onDelta: () => ac.abort(), onReset() {}, onStatus() {} }, signal: ac.signal });
    const r = await p;
    assert.ok(!r.ok && r.error.code === "CLIENT_ABORTED");
  });
  await withFetch(async () => { throw new TypeError("Failed to fetch"); }, async () => {
    const r = await streamChat({ ...args, handlers: handlersOf().handlers });
    assert.ok(!r.ok && r.error.code === "CLIENT_NETWORK");
  });
  clearTimeout(keepAlive);
});
