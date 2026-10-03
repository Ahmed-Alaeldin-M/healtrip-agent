import path from "node:path";
import { z } from "zod";
import { AppError } from "./errors";

const schema = z.object({
  GOOGLE_API_KEY: z.string().trim().min(1).optional(),
  GROQ_API_KEY: z.string().trim().min(1).optional(),
  GEMINI_MODEL_NAME: z.string().trim().min(1).default("gemini-2.5-flash"),
  GROQ_MODEL_NAME: z.string().trim().min(1).default("llama-3.3-70b-versatile"),
  EMBEDDING_MODEL: z.string().trim().min(1).default("Xenova/multilingual-e5-base"),
  DB_PATH: z.string().trim().min(1).default(path.join(process.cwd(), "data", "healtrip.db")),
  VECTORS_PATH: z.string().trim().min(1).default(path.join(process.cwd(), "data", "provider_vectors.json")),
  HF_CACHE_DIR: z.string().trim().min(1).default(path.join(process.cwd(), ".cache", "models")),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(8_000),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5000).max(300_000).default(55_000),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(10_000).default(20),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;
  // Empty strings in .env should behave like "unset".
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new AppError("CONFIG_MISSING_KEYS", {
      detail: `Invalid environment: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    });
  }
  cached = parsed.data;
  return cached;
}
