import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { embedQuery, embeddingState, __setLoaderForTests, __setEmbedderForTests } from "../src/lib/embeddings";
import { searchFiltered, __resetIndexForTests } from "../src/lib/vector-store";
import { filterProviders } from "../src/lib/db";
import { getConfig } from "../src/lib/config";

const dim = JSON.parse(fs.readFileSync("data/provider_vectors.json", "utf8")).dim as number;
const fakeExtractor = async () => ({ data: new Float32Array(dim).fill(1 / Math.sqrt(dim)) });

test("a model that is still loading fails fast, degrades, and recovers once it is ready", async () => {
  (getConfig() as { EMBEDDING_TIMEOUT_MS: number }).EMBEDDING_TIMEOUT_MS = 100;
  __setEmbedderForTests(null);
  __resetIndexForTests();
  let release!: () => void;
  __setLoaderForTests(() => new Promise((resolve) => { release = () => resolve(fakeExtractor); }));

  const t0 = Date.now();
  await assert.rejects(embedQuery("chest pain", dim), { code: "EMBEDDING_FAILED" });
  assert.ok(Date.now() - t0 < 1000, "must not wait for the whole model download");
  assert.equal(embeddingState(), "loading");

  const res = await searchFiltered("chest pain", filterProviders({ specialty: "Cardiology" }), 5);
  assert.equal(res.degraded, true);
  assert.equal(res.providers.length, 3);

  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(embeddingState(), "ready");
  const ranked = await searchFiltered("chest pain", filterProviders({ specialty: "Cardiology" }), 5);
  assert.equal(ranked.degraded, false);
});

test("a failed load is retried on the next request", async () => {
  let attempts = 0;
  __setLoaderForTests(async () => { attempts++; if (attempts === 1) throw new Error("network down"); return fakeExtractor; });
  await assert.rejects(embedQuery("x", dim), { code: "EMBEDDING_FAILED" });
  assert.equal(embeddingState(), "failed");
  assert.equal((await embedQuery("x", dim)).length, dim);
  assert.equal(attempts, 2);
});
