import { getConfig } from "./config";
import { AppError } from "./errors";

type Extractor = (text: string, opts: { pooling: "mean"; normalize: boolean }) => Promise<{ data: ArrayLike<number> }>;

export type EmbeddingState = "idle" | "loading" | "ready" | "failed";

// Next bundles instrumentation.ts and each route separately, so plain module variables are not shared between
// them. Keeping the state on globalThis lets the boot-time warm-up and the request handlers use the same model.
const g = globalThis as typeof globalThis & { __healtripEmb?: { promise: Promise<Extractor> | null; state: EmbeddingState } };
const shared = (g.__healtripEmb ??= { promise: null, state: "idle" });

export const embeddingState = (): EmbeddingState => shared.state;

async function loadExtractor(): Promise<Extractor> {
  const cfg = getConfig();
  const started = Date.now();
  console.info(`[embeddings] loading ${cfg.EMBEDDING_MODEL} (first run downloads the model, then it is cached in ${cfg.HF_CACHE_DIR})`);
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = cfg.HF_CACHE_DIR;
  // fp32 keeps the vectors closest to the sentence-transformers ones the FAISS index was built with.
  const p = await pipeline("feature-extraction", cfg.EMBEDDING_MODEL, { dtype: "fp32" });
  console.info(`[embeddings] model ready in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return p as unknown as Extractor;
}

let loader: () => Promise<Extractor> = loadExtractor;

/** Start loading in the background. Safe to call many times; never throws. */
function ensureExtractor(): Promise<Extractor> {
  if (!shared.promise) {
    shared.state = "loading";
    shared.promise = loader().then(
      (e) => { shared.state = "ready"; return e; },
      (err) => {
        // Allow a retry on the next call (e.g. the download failed or the network was down).
        shared.promise = null;
        shared.state = "failed";
        console.error("[embeddings] load failed", (err as Error)?.message);
        throw err;
      },
    );
  }
  return shared.promise;
}

/** Called at server start so the model download/load happens at boot instead of during a user's first request. */
export function warmUpEmbeddings(): void {
  ensureExtractor().catch(() => { /* already logged; the next request will retry */ });
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} not ready after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Test hooks. */
let override: ((text: string) => Promise<number[]>) | null = null;
export function __setEmbedderForTests(fn: ((text: string) => Promise<number[]>) | null) {
  override = fn;
}
export function __setLoaderForTests(fn: (() => Promise<Extractor>) | null) {
  loader = fn ?? loadExtractor;
  shared.promise = null;
  shared.state = "idle";
}

/**
 * Embed a search query using the e5 "query: " prefix. Returns an L2-normalised vector.
 * Bounded: if the model is still loading, this fails fast with EMBEDDING_FAILED (the caller degrades to
 * unranked results) while the load keeps going in the background for the next request.
 */
export async function embedQuery(query: string, expectedDim: number): Promise<number[]> {
  let vec: number[];
  try {
    if (override) {
      vec = await override(query);
    } else {
      const ms = getConfig().EMBEDDING_TIMEOUT_MS;
      const extractor = await withTimeout(ensureExtractor(), ms, "Embedding model");
      const out = await withTimeout(extractor(`query: ${query}`, { pooling: "mean", normalize: true }), ms, "Embedding");
      vec = Array.from(out.data);
    }
  } catch (err) {
    throw new AppError("EMBEDDING_FAILED", { cause: err });
  }
  if (vec.length !== expectedDim || vec.some((x) => !Number.isFinite(x))) {
    throw new AppError("EMBEDDING_FAILED", {
      detail: `Embedding dimension ${vec.length} does not match index dimension ${expectedDim}`,
    });
  }
  return vec;
}
