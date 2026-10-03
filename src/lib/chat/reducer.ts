import {
  HISTORY_ITEM_CHARS,
  HISTORY_MESSAGES,
  MAX_CONVERSATIONS,
  MAX_MESSAGES_PER_CHAT,
  type ChatMessage,
  type ChatState,
  type Conversation,
  type MessageError,
} from "./types";

export function emptyConversation(id: string, now: number): Conversation {
  return { id, title: "", titleSource: "auto", createdAt: now, updatedAt: now, messages: [] };
}

export const isPending = (c: Conversation | undefined) => !!c && c.messages.some((m) => m.status === "pending");
export const isFull = (c: Conversation | undefined) => !!c && c.messages.length >= MAX_MESSAGES_PER_CHAT;
export const canSend = (c: Conversation | undefined) => !!c && !isPending(c) && !isFull(c);

export function autoTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 40 ? `${t.slice(0, 40).trimEnd()}…` : t;
}

/** Completed turns only: failed or interrupted messages are never sent as context (keeps the transcript alternating). */
export function buildHistory(conv: Conversation, beforeMessageId?: string): { role: "user" | "assistant"; content: string }[] {
  const idx = beforeMessageId ? conv.messages.findIndex((m) => m.id === beforeMessageId) : conv.messages.length;
  const upTo = idx === -1 ? conv.messages.length : idx;
  const done = conv.messages.slice(0, upTo).filter((m) => m.status === "done");
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of done) {
    const prev = out.at(-1);
    if (prev && prev.role === m.role) continue; // defensive: never emit two same-role turns in a row
    out.push({ role: m.role, content: m.content.slice(0, HISTORY_ITEM_CHARS) });
  }
  let trimmed = out.slice(-HISTORY_MESSAGES);
  while (trimmed[0]?.role === "assistant") trimmed = trimmed.slice(1);
  while (trimmed.at(-1)?.role === "user") trimmed = trimmed.slice(0, -1);
  return trimmed;
}

export const byRecent = (a: Conversation, b: Conversation) => b.updatedAt - a.updatedAt;

function latestId(convs: Conversation[]): string | undefined {
  return [...convs].filter((c) => c.messages.length > 0).sort(byRecent)[0]?.id;
}

function prune(convs: Conversation[], keepId: string): Conversation[] {
  if (convs.length <= MAX_CONVERSATIONS) return convs;
  const removable = convs.filter((c) => c.id !== keepId && !isPending(c)).sort((a, b) => a.updatedAt - b.updatedAt);
  const drop = new Set(removable.slice(0, convs.length - MAX_CONVERSATIONS).map((c) => c.id));
  return convs.filter((c) => !drop.has(c.id));
}

export type Action =
  | { type: "hydrate"; conversations: Conversation[]; activeId?: string; newId: string; now: number }
  | { type: "sync"; conversations: Conversation[]; newId: string; now: number }
  | { type: "new"; id: string; now: number }
  | { type: "select"; id: string }
  | { type: "delete"; id: string; newId: string; now: number }
  | { type: "rename"; id: string; title: string }
  | { type: "send"; convId: string; message: ChatMessage }
  | { type: "stream"; convId: string; userId: string; assistantId: string; content: string; now: number }
  | { type: "succeed"; convId: string; userId: string; reply: ChatMessage }
  | { type: "fail"; convId: string; userId: string; error: MessageError }
  | { type: "retry"; convId: string; userId: string }
  | { type: "removeMessage"; convId: string; messageId: string };

function mapConv(state: ChatState, id: string, fn: (c: Conversation) => Conversation): ChatState {
  let changed = false;
  const conversations = state.conversations.map((c) => {
    if (c.id !== id) return c;
    const next = fn(c);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...state, conversations } : state;
}

export function reducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    case "hydrate": {
      const keep = action.activeId && action.conversations.some((c) => c.id === action.activeId) ? action.activeId : undefined;
      if (keep) return { conversations: action.conversations, activeId: keep, hydrated: true };
      // Fresh visit: start on a clean chat; history stays in the sidebar.
      const fresh = emptyConversation(action.newId, action.now);
      return { conversations: prune([fresh, ...action.conversations], fresh.id), activeId: fresh.id, hydrated: true };
    }

    case "sync": {
      // Another tab changed the stored history. Local in-flight chats win; everything else follows storage.
      const incoming = new Map(action.conversations.map((c) => [c.id, c]));
      const merged: Conversation[] = [];
      for (const local of state.conversations) {
        if (isPending(local)) merged.push(local);
        else if (incoming.has(local.id)) merged.push(incoming.get(local.id)!);
        else if (local.messages.length === 0) merged.push(local); // untouched blank chat
        // else: deleted in the other tab
        incoming.delete(local.id);
      }
      for (const c of incoming.values()) merged.push(c);
      if (merged.some((c) => c.id === state.activeId)) return { ...state, conversations: merged };
      const fallback = latestId(merged);
      if (fallback) return { ...state, conversations: merged, activeId: fallback };
      const fresh = emptyConversation(action.newId, action.now);
      return { ...state, conversations: [fresh, ...merged], activeId: fresh.id };
    }

    case "new": {
      const active = state.conversations.find((c) => c.id === state.activeId);
      if (active && active.messages.length === 0) return state; // already on a blank chat
      const blank = state.conversations.find((c) => c.messages.length === 0);
      if (blank) return { ...state, activeId: blank.id };
      const fresh = emptyConversation(action.id, action.now);
      return { ...state, conversations: prune([fresh, ...state.conversations], fresh.id), activeId: fresh.id };
    }

    case "select":
      return state.activeId !== action.id && state.conversations.some((c) => c.id === action.id) ? { ...state, activeId: action.id } : state;

    case "delete": {
      if (!state.conversations.some((c) => c.id === action.id)) return state;
      const rest = state.conversations.filter((c) => c.id !== action.id);
      if (state.activeId !== action.id) return { ...state, conversations: rest };
      const next = latestId(rest);
      if (next) return { ...state, conversations: rest, activeId: next };
      const fresh = emptyConversation(action.newId, action.now);
      return { ...state, conversations: [fresh], activeId: fresh.id };
    }

    case "rename": {
      const title = action.title.replace(/\s+/g, " ").trim().slice(0, 60);
      return mapConv(state, action.id, (c) =>
        title ? { ...c, title, titleSource: "user" } : { ...c, title: autoTitleFrom(c), titleSource: "auto" },
      );
    }

    case "send":
      return mapConv(state, action.convId, (c) => {
        if (!canSend(c)) return c;
        const first = c.messages.length === 0;
        return {
          ...c,
          title: first && c.titleSource === "auto" ? autoTitle(action.message.content) : c.title,
          updatedAt: action.message.createdAt,
          messages: [...c.messages, action.message],
        };
      });

    case "stream":
      // Upsert the partial answer after its user message. Empty content = a reset: drop the partial.
      return mapConv(state, action.convId, (c) => {
        const user = c.messages.find((m) => m.id === action.userId);
        if (!user || user.status !== "pending") return c;
        const existing = c.messages.find((m) => m.id === action.assistantId);
        if (!action.content) {
          return existing ? { ...c, messages: c.messages.filter((m) => m.id !== action.assistantId) } : c;
        }
        if (existing) {
          return existing.status === "streaming"
            ? { ...c, messages: c.messages.map((m) => (m.id === action.assistantId ? { ...m, content: action.content } : m)) }
            : c;
        }
        const partial: ChatMessage = { id: action.assistantId, role: "assistant", content: action.content, createdAt: action.now, status: "streaming" };
        return { ...c, messages: [...c.messages, partial] };
      });

    case "succeed":
      return mapConv(state, action.convId, (c) => {
        const target = c.messages.find((m) => m.id === action.userId);
        if (!target || target.status !== "pending") return c;
        const marked = c.messages.map((m) => (m.id === action.userId ? { ...m, status: "done" as const, error: undefined } : m));
        // The streamed partial (same id) becomes the final message; the `done` answer is authoritative.
        const hasPartial = marked.some((m) => m.id === action.reply.id);
        return {
          ...c,
          updatedAt: action.reply.createdAt,
          messages: hasPartial ? marked.map((m) => (m.id === action.reply.id ? action.reply : m)) : [...marked, action.reply],
        };
      });

    case "fail":
      return mapConv(state, action.convId, (c) => {
        const target = c.messages.find((m) => m.id === action.userId);
        if (!target || target.status !== "pending") return c;
        // A half-written answer is never kept: it could be a truncated piece of medical guidance.
        return {
          ...c,
          messages: c.messages
            .filter((m) => m.status !== "streaming")
            .map((m) => (m.id === action.userId ? { ...m, status: "error" as const, error: action.error } : m)),
        };
      });

    case "retry":
      return mapConv(state, action.convId, (c) => {
        const last = c.messages.at(-1);
        if (!last || last.id !== action.userId || last.role !== "user" || last.status !== "error") return c;
        return { ...c, messages: c.messages.map((m) => (m.id === action.userId ? { ...m, status: "pending" as const, error: undefined } : m)) };
      });

    case "removeMessage":
      return mapConv(state, action.convId, (c) => {
        const target = c.messages.find((m) => m.id === action.messageId);
        if (!target || target.status === "pending") return c;
        return { ...c, messages: c.messages.filter((m) => m.id !== action.messageId) };
      });
  }
}

function autoTitleFrom(c: Conversation): string {
  const first = c.messages.find((m) => m.role === "user");
  return first ? autoTitle(first.content) : "";
}
