import { z } from "zod";
import {
  MAX_CONVERSATIONS,
  MAX_MESSAGES_PER_CHAT,
  STORED_CONTENT_CHARS,
  type ChatMessage,
  type Conversation,
} from "./types";

export const STORAGE_KEY = "healtrip:chats:v1";
export const ACTIVE_KEY = "healtrip:active:v1"; // sessionStorage: per-tab, so tabs never fight over it
export const LANG_KEY = "healtrip:lang:v1";

const messageSchema = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.number().finite(),
  status: z.enum(["pending", "done", "error", "streaming"]).catch("done"),
  error: z
    .object({ code: z.string(), message: z.string(), retryable: z.boolean(), retryAt: z.number().finite().optional() })
    .optional(),
});

const conversationSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().max(200).catch(""),
  titleSource: z.enum(["auto", "user"]).catch("auto"),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  messages: z.array(z.unknown()),
});

const INTERRUPTED = {
  code: "INTERRUPTED",
  message: "This message was interrupted before it finished.",
  retryable: true,
} as const;

/** Persisted form: never store in-flight requests (they cannot survive a reload) and skip blank chats. */
export function toPersisted(conversations: Conversation[]): Conversation[] {
  return conversations
    .filter((c) => c.messages.length > 0)
    .map((c) => ({
      ...c,
      messages: c.messages.filter((m) => m.status !== "streaming").map((m) =>
        m.status === "pending" ? { ...m, status: "error" as const, error: { ...INTERRUPTED } } : m,
      ),
    }));
}

export function serialize(conversations: Conversation[]): string {
  return JSON.stringify({ version: 1, conversations: toPersisted(conversations) });
}

/** Tolerant parser: one bad conversation or message never takes the rest of the history down with it. */
export function parseStored(raw: string | null): { conversations: Conversation[]; corrupt: boolean } {
  if (!raw) return { conversations: [], corrupt: false };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { conversations: [], corrupt: true };
  }
  const list = (json as { conversations?: unknown })?.conversations;
  if (!Array.isArray(list)) return { conversations: [], corrupt: true };

  let dropped = false;
  const seen = new Set<string>();
  const conversations: Conversation[] = [];
  for (const rawConv of list) {
    const c = conversationSchema.safeParse(rawConv);
    if (!c.success || seen.has(c.data.id)) {
      dropped = true;
      continue;
    }
    seen.add(c.data.id);
    const messages: ChatMessage[] = [];
    for (const rawMsg of c.data.messages.slice(0, MAX_MESSAGES_PER_CHAT)) {
      const m = messageSchema.safeParse(rawMsg);
      if (!m.success) {
        dropped = true;
        continue;
      }
      if (m.data.status === "streaming") continue; // a partial answer from a page that was closed mid-stream
      const msg: ChatMessage = { ...m.data, content: m.data.content.slice(0, STORED_CONTENT_CHARS) };
      if (msg.status === "pending") {
        msg.status = "error";
        msg.error = { ...INTERRUPTED };
      }
      // assistant messages are never pending/error; normalise stray values
      if (msg.role === "assistant") {
        msg.status = "done";
        delete msg.error;
      }
      messages.push(msg);
    }
    if (messages.length > 0) conversations.push({ ...c.data, messages });
  }
  conversations.sort((a, b) => b.updatedAt - a.updatedAt);
  return { conversations: conversations.slice(0, MAX_CONVERSATIONS), corrupt: dropped && conversations.length === 0 };
}

export interface SaveResult {
  ok: boolean;
  pruned: boolean;
  serialized?: string;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Write history; on quota errors drop the oldest chats and retry once. Never throws. */
export function saveConversations(storage: StorageLike | null, conversations: Conversation[]): SaveResult {
  if (!storage) return { ok: false, pruned: false };
  let list = conversations;
  for (let attempt = 0; attempt < 2; attempt++) {
    const serialized = serialize(list);
    try {
      storage.setItem(STORAGE_KEY, serialized);
      return { ok: true, pruned: attempt > 0, serialized };
    } catch {
      const keep = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, Math.floor(list.length / 2)));
      if (keep.length === list.length && list.length === 1) break;
      list = keep;
    }
  }
  return { ok: false, pruned: false };
}

/** localStorage access can throw (privacy mode, blocked cookies); callers get null instead. */
export function safeStorage(kind: "local" | "session"): Storage | null {
  try {
    const s = kind === "local" ? window.localStorage : window.sessionStorage;
    const probe = "__healtrip_probe__";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
