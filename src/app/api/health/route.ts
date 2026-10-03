import { agentConfigured } from "@/lib/agent";
import { dbHealthy } from "@/lib/db";
import fs from "node:fs";
import { getConfig } from "@/lib/config";
import { embeddingState } from "@/lib/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  let index = false;
  try {
    index = fs.existsSync(getConfig().VECTORS_PATH);
  } catch { /* config invalid */ }
  const checks = { database: dbHealthy(), index, llm: agentConfigured() };
  const ok = Object.values(checks).every(Boolean);
  return Response.json({ ok, checks, embeddings: embeddingState() }, { status: ok ? 200 : 503 });
}
