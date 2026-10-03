import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AppError, classifyError } from "../src/lib/errors";
import { filterProviders } from "../src/lib/db";
import { searchFiltered, __resetIndexForTests } from "../src/lib/vector-store";
import { __setEmbedderForTests } from "../src/lib/embeddings";
import { findProviders } from "../src/lib/tools";
import { checkRateLimit, __resetRateLimitForTests } from "../src/lib/rate-limit";
import { parseChatRequest, normalizeHistory } from "../src/lib/request";

const vectors = JSON.parse(fs.readFileSync("data/provider_vectors.json", "utf8"));
const vecOf = (id: string): number[] => vectors.items.find((i: { id: string }) => i.id === id).vector;

const req = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("http://x/api/chat", { method: "POST", body, headers });

test("classifyError maps provider failures", () => {
  assert.equal(classifyError(Object.assign(new Error("x"), { status: 429 })).code, "LLM_RATE_LIMIT");
  assert.equal(classifyError(Object.assign(new Error("x"), { status: 401 })).code, "LLM_AUTH");
  assert.equal(classifyError(Object.assign(new Error("x"), { status: 503 })).code, "LLM_OVERLOADED");
  assert.equal(classifyError(new Error("[GoogleGenerativeAI Error]: Response was blocked due to SAFETY")).code, "LLM_CONTENT_BLOCKED");
  assert.equal(classifyError(new Error("maximum context length exceeded")).code, "LLM_CONTEXT_LENGTH");
  assert.equal(classifyError(new DOMException("t", "TimeoutError")).code, "LLM_TIMEOUT");
  assert.equal(classifyError(new DOMException("a", "AbortError")).code, "CLIENT_ABORTED");
  assert.equal(classifyError(new TypeError("fetch failed")).code, "LLM_NETWORK");
  assert.equal(classifyError(new Error("Received empty response from chat model call.")).code, "LLM_EMPTY_RESPONSE");
  assert.equal(classifyError("weird").code, "INTERNAL");
  assert.equal(classifyError(null).code, "INTERNAL");
});

test("user messages are localized and carry the emergency line on server-side failures", () => {
  assert.match(new AppError("DB_UNAVAILABLE").userMessage("en"), /emergency/i);
  assert.match(new AppError("DB_UNAVAILABLE").userMessage("ar"), /طوارئ/);
  assert.doesNotMatch(new AppError("INVALID_JSON").userMessage("en"), /emergency/i);
});

test("request parsing rejects bad input", async () => {
  await assert.rejects(parseChatRequest(req("{bad")), { code: "INVALID_JSON" });
  await assert.rejects(parseChatRequest(req("{}")), { code: "INVALID_REQUEST" });
  await assert.rejects(parseChatRequest(req('{"message":"   "}')), { code: "INVALID_REQUEST" });
  await assert.rejects(parseChatRequest(req(JSON.stringify({ message: "a".repeat(2001) }))), { code: "MESSAGE_TOO_LONG" });
  await assert.rejects(parseChatRequest(req('{"message":"hi","language":"fr"}')), { code: "INVALID_REQUEST" });
  await assert.rejects(parseChatRequest(req('{"message":"hi","threadId":"nope"}')), { code: "INVALID_REQUEST" });
  await assert.rejects(parseChatRequest(req("{}", { "content-type": "text/plain" })), { code: "INVALID_REQUEST" });
  await assert.rejects(parseChatRequest(req(JSON.stringify({ message: "a".repeat(200_000) }))), { code: "PAYLOAD_TOO_LARGE" });
  const ok = await parseChatRequest(req('{"message":" hi "}'));
  assert.equal(ok.message, "hi");
  assert.equal(ok.lang, "en");
  assert.ok(ok.threadId);
});

test("rate limiter blocks after the limit", () => {
  __resetRateLimitForTests();
  for (let i = 0; i < 20; i++) checkRateLimit("ip1", 1000); // default limit is 20/min
  assert.throws(() => checkRateLimit("ip1", 1000), { code: "RATE_LIMITED" });
  checkRateLimit("ip1", 1000 + 61_000);
  checkRateLimit("ip2", 1000);
});

test("sql filters are case-insensitive and composable", () => {
  assert.equal(filterProviders({ specialty: "cardiology", city: "RIYADH" }).length, 1);
  assert.equal(filterProviders({ emergency: true }).length, 3);
  assert.equal(filterProviders({ provider_type: "hospital" }).length, 5);
  assert.equal(filterProviders({ specialty: "Nonexistent" }).length, 0);
  assert.equal(filterProviders({ city: "x'; DROP TABLE providers;--" }).length, 0);
  assert.equal(filterProviders({}).length, 25);
});

test("semantic ranking over filtered candidates (fake embedder = D001 vector)", async () => {
  __resetIndexForTests();
  __setEmbedderForTests(async () => vecOf("D001"));
  const res = await searchFiltered("chest pain", filterProviders({ specialty: "Cardiology" }), 5);
  assert.equal(res.degraded, false);
  assert.equal(res.providers[0]?.id, "D001");
  assert.ok((res.providers[0]?.semantic_score ?? 0) > 0.99);
  assert.equal(res.providers.length, 3);
});

test("embedding failure degrades to unranked results", async () => {
  __resetIndexForTests();
  __setEmbedderForTests(async () => { throw new Error("model download failed"); });
  const res = await searchFiltered("x", filterProviders({ specialty: "Cardiology" }), 5);
  assert.equal(res.degraded, true);
  assert.equal(res.providers.length, 3);
  assert.equal(res.providers[0]?.semantic_score, null);
});

test("wrong embedding dimension degrades instead of crashing", async () => {
  __resetIndexForTests();
  __setEmbedderForTests(async () => [1, 2, 3]);
  const res = await searchFiltered("x", filterProviders({ specialty: "Cardiology" }), 5);
  assert.equal(res.degraded, true);
});

test("missing and corrupt index are typed errors", async () => {
  const cands = filterProviders({ specialty: "Cardiology" });
  __resetIndexForTests();
  process.env.VECTORS_PATH = "/nonexistent.json";
  const { getConfig } = await import("../src/lib/config");
  // config is cached; point the cached object at bad paths directly
  (getConfig() as { VECTORS_PATH: string }).VECTORS_PATH = "/nonexistent.json";
  await assert.rejects(searchFiltered("x", cands), { code: "INDEX_MISSING" });
  fs.writeFileSync("/tmp/bad.json", "{not json");
  (getConfig() as { VECTORS_PATH: string }).VECTORS_PATH = "/tmp/bad.json";
  __resetIndexForTests();
  await assert.rejects(searchFiltered("x", cands), { code: "INDEX_CORRUPT" });
  fs.writeFileSync("/tmp/bad2.json", JSON.stringify({ model: "m", dim: 3, items: [{ id: "D001", vector: [1, 2] }] }));
  (getConfig() as { VECTORS_PATH: string }).VECTORS_PATH = "/tmp/bad2.json";
  __resetIndexForTests();
  await assert.rejects(searchFiltered("x", cands), { code: "INDEX_CORRUPT" });
});

test("find_providers tool never throws and reports errors as data", async () => {
  const { getConfig } = await import("../src/lib/config");
  (getConfig() as { VECTORS_PATH: string }).VECTORS_PATH = "/nonexistent.json";
  __resetIndexForTests();
  const out = JSON.parse(await findProviders.invoke({ query: "chest pain", specialty: "Cardiology" }));
  assert.equal(out.ok, false);
  assert.equal(out.error.code, "INDEX_MISSING");
  assert.deepEqual(out.providers, []);

  const none = JSON.parse(await findProviders.invoke({ query: "x", specialty: "Nope" }));
  assert.equal(none.ok, true);
  assert.deepEqual(none.providers, []);
});

test("history normalization yields a provider-safe alternating transcript", () => {
  const h = normalizeHistory([
    { role: "assistant", content: "orphan reply" },
    { role: "user", content: "a" },
    { role: "user", content: "b" },
    { role: "assistant", content: "  " },
    { role: "assistant", content: "c" },
    { role: "user", content: "dangling" },
  ]);
  assert.deepEqual(h, [{ role: "user", content: "a\nb" }, { role: "assistant", content: "c" }]);
  const many = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? ("assistant" as const) : ("user" as const), content: String(i) }));
  const out = normalizeHistory(many);
  assert.ok(out.length <= 12);
  assert.equal(out[0]?.role, "user");
  assert.equal(out.at(-1)?.role, "assistant");
  assert.equal(normalizeHistory([{ role: "user", content: "x".repeat(9000) }, { role: "assistant", content: "y" }])[0]!.content.length, 3000);
});
