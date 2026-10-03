export type Lang = "en" | "ar";

export const MAX_INPUT_CHARS = 2000;
export const MAX_MESSAGES_PER_CHAT = 60;
export const MAX_CONVERSATIONS = 50;
export const HISTORY_MESSAGES = 12;
export const HISTORY_ITEM_CHARS = 3000;
export const STORED_CONTENT_CHARS = 20_000;

export interface MessageError {
  code: string;
  message: string;
  retryable: boolean;
  /** epoch ms before which Retry is disabled (rate limits) */
  retryAt?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  /**
   * pending = request in flight (user messages); error = request failed (user messages);
   * streaming = answer still being written (assistant messages, never persisted)
   */
  status: "pending" | "done" | "error" | "streaming";
  error?: MessageError;
}

export interface Conversation {
  id: string;
  /** "" = untitled; the UI shows a localized placeholder */
  title: string;
  titleSource: "auto" | "user";
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ChatState {
  conversations: Conversation[];
  activeId: string;
  hydrated: boolean;
}

export const initialState: ChatState = { conversations: [], activeId: "", hydrated: false };
