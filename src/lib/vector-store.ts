import fs from "node:fs";
import { z } from "zod";
import { getConfig } from "./config";
import { embedQuery } from "./embeddings";
import { AppError } from "./errors";
import type { Provider } from "./db";

const indexSchema = z.object({
  model: z.string(),
  dim: z.number().int().positive(),
  items: z.array(z.object({ id: z.string().min(1), vector: z.array(z.number().finite()) })).min(1),
});

export interface RankedProvider extends Provider {
  semantic_score: number | null;
}

class VectorIndex {
  readonly dim: number;
  private readonly vectors = new Map<string, Float32Array>();

  constructor(raw: unknown) {
    const parsed = indexSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INDEX_CORRUPT", { cause: parsed.error });
    this.dim = parsed.data.dim;
    for (const item of parsed.data.items) {
      if (item.vector.length !== this.dim) {
        throw new AppError("INDEX_CORRUPT", { detail: `Vector ${item.id} has ${item.vector.length} dims, expected ${this.dim}` });
      }
      if (this.vectors.has(item.id)) throw new AppError("INDEX_CORRUPT", { detail: `Duplicate vector id ${item.id}` });
      this.vectors.set(item.id, Float32Array.from(item.vector));
    }
  }

  has(id: string) {
    return this.vectors.has(id);
  }

  /** Cosine similarity == dot product because stored vectors and the query are L2-normalised. */
  rank(query: number[], candidates: Provider[], limit: number): RankedProvider[] {
    const scored: RankedProvider[] = [];
    for (const p of candidates) {
      const v = this.vectors.get(p.id);
      if (!v) continue;
      let dot = 0;
      for (let i = 0; i < this.dim; i++) dot += v[i]! * query[i]!;
      scored.push({ ...p, semantic_score: dot });
    }
    return scored.sort((a, b) => (b.semantic_score ?? 0) - (a.semantic_score ?? 0)).slice(0, limit);
  }
}

let index: VectorIndex | null = null;

function loadIndex(): VectorIndex {
  if (index) return index;
  const file = getConfig().VECTORS_PATH;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new AppError("INDEX_MISSING", { cause: err });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new AppError("INDEX_CORRUPT", { cause: err });
  }
  index = new VectorIndex(raw);
  return index;
}

export function __resetIndexForTests() {
  index = null;
}

export interface SearchResult {
  providers: RankedProvider[];
  /** true when semantic ranking failed and results are only SQL-filtered, not ranked */
  degraded: boolean;
  warnings: string[];
}

/**
 * Semantic ranking over an already SQL-filtered candidate set.
 * If embeddings fail, degrade to the filtered list instead of failing the whole request.
 */
export async function searchFiltered(query: string, candidates: Provider[], limit = 5): Promise<SearchResult> {
  const warnings: string[] = [];
  if (candidates.length === 0) return { providers: [], degraded: false, warnings };

  const idx = loadIndex(); // INDEX_MISSING / INDEX_CORRUPT propagate: no index at all is a hard failure for ranking
  const indexed = candidates.filter((p) => idx.has(p.id));
  if (indexed.length < candidates.length) {
    warnings.push(`${candidates.length - indexed.length} provider(s) are missing from the search index and were skipped.`);
  }
  if (indexed.length === 0) return { providers: [], degraded: false, warnings };

  try {
    const q = await embedQuery(query, idx.dim);
    return { providers: idx.rank(q, indexed, limit), degraded: false, warnings };
  } catch (err) {
    if (err instanceof AppError && err.code === "EMBEDDING_FAILED") {
      warnings.push("Semantic ranking was unavailable; results are filtered but not ranked by relevance.");
      return {
        providers: indexed.slice(0, limit).map((p) => ({ ...p, semantic_score: null })),
        degraded: true,
        warnings,
      };
    }
    throw err;
  }
}
