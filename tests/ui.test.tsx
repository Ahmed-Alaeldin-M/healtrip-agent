import { jsdomWindow as win } from "./dom-setup";
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ChatApp from "../src/components/ChatApp";
import { STORAGE_KEY } from "../src/lib/chat/storage";

type Call = { url: string; body: any; signal?: AbortSignal | null };
let calls: Call[] = [];
let handler: (call: Call) => Promise<Response> | Response;
const ok = (answer: string) => Response.json({ ok: true, answer });
const deferred = () => { let resolve!: (r: Response) => void; const p = new Promise<Response>((r) => (resolve = r)); return { p, resolve }; };

beforeEach(() => {
  calls = [];
  win.localStorage.clear();
  win.sessionStorage.clear();
  win.confirm = () => true;
  handler = () => ok("default reply");
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("/api/health")) return Response.json({ ok: true });
    const call = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")), signal: init?.signal };
    calls.push(call);
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      Promise.resolve().then(() => handler(call)).then(resolve, reject);
    });
  }) as typeof fetch;
});
afterEach(() => cleanup());

const input = () => document.querySelector("#chat-message") as HTMLInputElement;
async function say(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  await act(async () => { fireEvent.submit(input().closest("form")!); });
}
const sidebar = () => within(document.querySelector(".sidebar") as HTMLElement);

test("welcome screen, suggestion fills the composer", async () => {
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  fireEvent.click(screen.getByText("Understand a symptom"));
  assert.equal(input().value, "I’d like help understanding a symptom");
});

test("send shows pending state, then the markdown reply; history grows turn by turn", async () => {
  const d = deferred();
  handler = () => d.p;
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("hello");
  assert.ok(screen.getByRole("status", { name: "Healtrip is thinking" }));
  assert.ok(screen.getByLabelText("Stop"));
  assert.deepEqual(calls[0]!.body.history, []);
  assert.equal(calls[0]!.body.language, "en");
  assert.match(calls[0]!.body.threadId, /^[0-9a-f-]{36}$/);
  await act(async () => d.resolve(ok("**Hi** there\n\n- one\n- two")));
  await waitFor(() => assert.ok(document.querySelector(".md strong")));
  assert.equal(document.querySelectorAll(".md li").length, 2);
  assert.equal(screen.queryByRole("status", { name: "Healtrip is thinking" }), null);

  handler = () => ok("second");
  await say("more");
  assert.deepEqual(calls[1]!.body.history, [{ role: "user", content: "hello" }, { role: "assistant", content: "**Hi** there\n\n- one\n- two" }]);
  await screen.findByText("second");
});

test("markdown is sanitized: raw HTML and javascript: links never become live", async () => {
  handler = () => ok('<img src=x onerror="alert(1)"> [bad](javascript:alert(1)) [good](https://example.com)');
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("x");
  await waitFor(() => assert.ok(document.querySelector(".md")));
  assert.equal(document.querySelector(".md img"), null);
  const hrefs = [...document.querySelectorAll(".md a")].map((a) => a.getAttribute("href"));
  assert.ok(!hrefs.some((h) => h?.startsWith("javascript:")));
  assert.ok(hrefs.includes("https://example.com"));
});

test("switching chats: new chat is blank, old chat keeps its messages, replies land in the chat that asked", async () => {
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("question A");
  await screen.findByText("default reply");

  const d = deferred();
  handler = () => d.p;
  await say("question A2");
  fireEvent.click(sidebar().getByText("New conversation", { selector: "button" }));
  await screen.findByText(/better today\?/);
  assert.equal(document.querySelector(".busy-dot") !== null, true, "sidebar shows chat A is still busy");

  handler = () => ok("reply for B");
  await say("question B");
  await screen.findByText("reply for B");
  assert.deepEqual(calls.at(-1)!.body.history, []);
  assert.notEqual(calls.at(-1)!.body.threadId, calls[0]!.body.threadId);

  await act(async () => d.resolve(ok("late reply for A")));
  assert.equal(screen.queryByText("late reply for A"), null, "must not leak into chat B");
  fireEvent.click(sidebar().getByText("question A"));
  await screen.findByText("late reply for A");
  assert.equal(screen.queryByText("reply for B"), null);
});

test("failure shows a typed error; Retry resends without duplicating, and the failed turn is not part of history", async () => {
  handler = () => Response.json({ ok: false, error: { code: "LLM_OVERLOADED", message: "The language model is overloaded.", retryable: true } }, { status: 503 });
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("will fail");
  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent!, /overloaded/);

  handler = () => ok("recovered");
  await act(async () => { fireEvent.click(screen.getByText("Try again")); });
  await screen.findByText("recovered");
  assert.equal(within(document.querySelector(".messages") as HTMLElement).getAllByText("will fail").length, 1);
  assert.equal(screen.queryByRole("alert"), null);
  assert.deepEqual(calls[1]!.body.history, []);
  assert.equal(calls[1]!.body.message, "will fail");
});

test("network failure, HTML gateway page, and rate limit countdown are all handled", async () => {
  render(<ChatApp />);
  await screen.findByText(/better today\?/);

  handler = () => { throw new TypeError("Failed to fetch"); };
  await say("one");
  assert.match((await screen.findByRole("alert")).textContent!, /Couldn’t reach the server/);

  handler = () => new Response("<html>Bad gateway</html>", { status: 502 });
  await act(async () => { fireEvent.click(screen.getByText("Try again")); });
  await waitFor(() => assert.match(screen.getByRole("alert").textContent!, /unexpected response/));

  handler = () => Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many requests.", retryable: true } }, { status: 429, headers: { "retry-after": "30" } });
  await act(async () => { fireEvent.click(screen.getByText("Try again")); });
  await waitFor(() => assert.ok(screen.getByText(/Try again in \d+s/)));
  assert.equal((screen.getByText(/Try again in \d+s/) as HTMLButtonElement).disabled, true);
});

test("non-retryable error offers Edit and resend, which moves the text back into the composer", async () => {
  handler = () => Response.json({ ok: false, error: { code: "LLM_CONTENT_BLOCKED", message: "Blocked by safety filter.", retryable: false } }, { status: 422 });
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("risky text");
  await screen.findByRole("alert");
  assert.equal(screen.queryByText("Try again"), null);
  fireEvent.click(screen.getByText("Edit and resend"));
  assert.equal(input().value, "risky text");
  assert.equal(screen.queryByRole("alert"), null);
});

test("context-length error offers a new chat", async () => {
  handler = () => Response.json({ ok: false, error: { code: "LLM_CONTEXT_LENGTH", message: "Too long.", retryable: false } }, { status: 413 });
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("hi");
  await screen.findByRole("alert");
  fireEvent.click(screen.getByText("Start a new chat"));
  await screen.findByText(/better today\?/);
});

test("Stop aborts the request and offers a retry", async () => {
  handler = (c) => new Promise(() => {});
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("slow one");
  await act(async () => { fireEvent.click(screen.getByLabelText("Stop")); });
  await waitFor(() => assert.match(screen.getByRole("alert").textContent!, /Stopped/));
  assert.ok(screen.getByText("Try again"));
});

test("history persists across reloads; a request that was in flight comes back as interrupted", async () => {
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("remember me");
  await screen.findByText("default reply");
  handler = () => new Promise(() => {});
  await say("still going");
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  const stored = JSON.parse(win.localStorage.getItem(STORAGE_KEY)!);
  assert.equal(stored.conversations.length, 1);
  cleanup();

  win.sessionStorage.clear(); // new tab
  handler = () => ok("after reload");
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  fireEvent.click(sidebar().getByText("remember me"));
  await screen.findByText("default reply");
  assert.match((await screen.findByRole("alert")).textContent!, /interrupted/);
  await act(async () => { fireEvent.click(screen.getByText("Try again")); });
  await screen.findByText("after reload");
  assert.deepEqual(calls.at(-1)!.body.history, [{ role: "user", content: "remember me" }, { role: "assistant", content: "default reply" }]);
});

test("corrupt storage does not crash the app", async () => {
  win.localStorage.setItem(STORAGE_KEY, "{definitely not json");
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  assert.match(screen.getAllByRole("status").map((n) => n.textContent).join(" "), /unreadable/);
  await say("still works");
  await screen.findByText("default reply");
});

test("delete removes the chat and falls back; deleting a busy chat aborts it quietly", async () => {
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("first chat");
  await screen.findByText("default reply");
  fireEvent.click(sidebar().getByText("New conversation", { selector: "button" }));
  handler = () => new Promise(() => {});
  await say("busy chat");
  fireEvent.click(sidebar().getByLabelText("Delete: busy chat"));
  await waitFor(() => assert.equal(sidebar().queryByText("busy chat"), null));
  assert.ok(sidebar().getByText("first chat"));
  await screen.findByText("default reply");
  assert.equal(screen.queryByRole("alert"), null);
});

test("rename via the options menu", async () => {
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("hello");
  await screen.findByText("default reply");
  win.prompt = () => "Blood pressure plan";
  fireEvent.click(screen.getByLabelText("Conversation options"));
  fireEvent.click(screen.getByText("Rename conversation"));
  await waitFor(() => assert.ok(sidebar().getByText("Blood pressure plan")));
});

test("language toggle flips direction and the request language", async () => {
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  fireEvent.click(screen.getByLabelText("Switch to Arabic"));
  assert.equal(document.querySelector("main")!.getAttribute("dir"), "rtl");
  await say("مرحبا");
  await screen.findByText("default reply");
  assert.equal(calls[0]!.body.language, "ar");
});

test("another tab's changes show up via the storage event", async () => {
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  const remote = { version: 1, conversations: [{ id: "remote-1", title: "From tab two", titleSource: "auto", createdAt: 1, updatedAt: Date.now(), messages: [{ id: "a", role: "user", content: "From tab two", createdAt: 1, status: "done" }, { id: "b", role: "assistant", content: "hey", createdAt: 2, status: "done" }] }] };
  await act(async () => { win.dispatchEvent(new win.StorageEvent("storage", { key: STORAGE_KEY, newValue: JSON.stringify(remote) })); });
  assert.ok(sidebar().getByText("From tab two"));
});

const enc = new TextEncoder();
function liveStream(call: Call) {
  let c!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(ctl) { c = ctl; } });
  call.signal?.addEventListener("abort", () => { try { c.error(call.signal!.reason); } catch { /* closed */ } });
  const res = new Response(body, { headers: { "content-type": "text/event-stream" } });
  const send = (event: string, data: unknown) => c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  return { res, send, close: () => c.close() };
}
const tick = (ms = 80) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

test("streaming: the answer appears token by token, then is finalized with the authoritative text", async () => {
  let live!: ReturnType<typeof liveStream>;
  handler = (call) => { live = liveStream(call); return live.res; };
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("how are you");
  assert.equal(calls[0]!.body.stream, true);
  assert.ok(screen.getByRole("status", { name: "Healtrip is thinking" }));

  await act(async () => { live.send("start", {}); live.send("delta", { text: "I am " }); });
  await tick();
  assert.equal(screen.queryByRole("status", { name: "Healtrip is thinking" }), null, "typing dots give way to the text");
  assert.match(document.querySelector(".assistant-bubble")!.textContent!, /I am/);
  assert.ok(document.querySelector(".caret"));
  assert.ok(screen.getByLabelText("Stop"), "still stoppable while streaming");

  await act(async () => { live.send("delta", { text: "**fine**" }); });
  await tick();
  assert.ok(document.querySelector(".assistant-bubble strong"));

  await act(async () => { live.send("done", { answer: "I am **fine**, thanks." }); live.close(); });
  await screen.findByText(/thanks\./);
  assert.equal(document.querySelector(".caret"), null);
  assert.equal(document.querySelectorAll(".assistant-bubble").length, 1);

  handler = () => ok("next");
  await say("again");
  assert.deepEqual(calls[1]!.body.history, [{ role: "user", content: "how are you" }, { role: "assistant", content: "I am **fine**, thanks." }]);
});

test("streaming: tool lookup shows 'Searching providers', and the preamble is discarded", async () => {
  let live!: ReturnType<typeof liveStream>;
  handler = (call) => { live = liveStream(call); return live.res; };
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("find a cardiologist in الرياض");
  await act(async () => { live.send("delta", { text: "Let me look." }); });
  await tick();
  assert.match(document.querySelector(".assistant-bubble")!.textContent!, /Let me look/);
  await act(async () => { live.send("reset", {}); live.send("status", { phase: "searching" }); });
  await tick();
  assert.equal(document.querySelector(".assistant-bubble"), null);
  assert.ok(screen.getByText("Searching providers…"));
  await act(async () => { live.send("delta", { text: "Dr. Sara" }); live.send("done", { answer: "Dr. Sara Al-Harbi." }); live.close(); });
  await screen.findByText("Dr. Sara Al-Harbi.");
  assert.equal(screen.queryByText("Let me look."), null);
  assert.equal(screen.queryByText("Searching providers…"), null);
});

test("streaming: an error event mid-answer removes the partial text and offers retry", async () => {
  let live!: ReturnType<typeof liveStream>;
  handler = (call) => { live = liveStream(call); return live.res; };
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("question");
  await act(async () => { live.send("delta", { text: "The dose is 5" }); });
  await tick();
  await act(async () => { live.send("error", { code: "LLM_OVERLOADED", message: "The language model is overloaded.", retryable: true }); live.close(); });
  assert.match((await screen.findByRole("alert")).textContent!, /overloaded/);
  assert.equal(screen.queryByText(/The dose is 5/), null, "a truncated answer must never stay on screen");
  assert.ok(screen.getByText("Try again"));
});

test("streaming: a dropped connection (no done event) is an error, not a finished answer", async () => {
  let live!: ReturnType<typeof liveStream>;
  handler = (call) => { live = liveStream(call); return live.res; };
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("question");
  await act(async () => { live.send("delta", { text: "Half an ans" }); });
  await tick();
  await act(async () => { live.close(); });
  assert.match((await screen.findByRole("alert")).textContent!, /connection dropped/);
  assert.equal(screen.queryByText(/Half an ans/), null);
});

test("streaming: Stop mid-answer discards the partial text and offers retry", async () => {
  let live!: ReturnType<typeof liveStream>;
  handler = (call) => { live = liveStream(call); return live.res; };
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("question");
  await act(async () => { live.send("delta", { text: "Writing a long ans" }); });
  await tick();
  await act(async () => { fireEvent.click(screen.getByLabelText("Stop")); });
  await waitFor(() => assert.match(screen.getByRole("alert").textContent!, /Stopped/));
  assert.equal(screen.queryByText(/Writing a long/), null);
});

test("streaming: a partial answer is never saved; reloading mid-stream shows the message as interrupted", async () => {
  let live!: ReturnType<typeof liveStream>;
  handler = (call) => { live = liveStream(call); return live.res; };
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("question");
  await act(async () => { live.send("delta", { text: "partial text" }); });
  await tick(400);
  const saved = win.localStorage.getItem(STORAGE_KEY)!;
  assert.ok(!saved.includes("partial text"));
  cleanup();
  win.sessionStorage.clear();
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  fireEvent.click(sidebar().getByText("question"));
  assert.match((await screen.findByRole("alert")).textContent!, /interrupted/);
  assert.equal(screen.queryByText(/partial text/), null);
});

test("streaming: tokens land in the chat that asked, even after switching chats", async () => {
  let live!: ReturnType<typeof liveStream>;
  handler = (call) => { live = liveStream(call); return live.res; };
  render(<ChatApp />);
  await screen.findByText(/better today\?/);
  await say("chat A question");
  await act(async () => { live.send("delta", { text: "streaming into A" }); });
  await tick();
  fireEvent.click(sidebar().getByText("New conversation", { selector: "button" }));
  await screen.findByText(/better today\?/);
  await act(async () => { live.send("delta", { text: " more" }); live.send("done", { answer: "streaming into A more" }); live.close(); });
  await tick();
  assert.equal(screen.queryByText(/streaming into A/), null, "must not appear in the new chat");
  fireEvent.click(sidebar().getByText("chat A question"));
  await screen.findByText("streaming into A more");
});
