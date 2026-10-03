import test from "node:test";
import assert from "node:assert/strict";
import { POST, GET } from "../src/app/api/chat/route";

delete process.env.GOOGLE_API_KEY;
delete process.env.GROQ_API_KEY;

const post = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
  POST(new Request("http://x/api/chat", { method: "POST", body, headers }));

test("route returns typed JSON errors, never HTML", async () => {
  let r = await post("{bad");
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error.code, "INVALID_JSON");

  r = await post('{"message":"chest pain","language":"ar"}');
  const j = await r.json();
  assert.equal(r.status, 503);
  assert.equal(j.error.code, "CONFIG_MISSING_KEYS");
  assert.match(j.error.message, /طوارئ/);
  assert.ok(r.headers.get("x-request-id"));

  assert.equal(GET().status, 405);
});
