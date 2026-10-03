import { GraphRecursionError } from "@langchain/langgraph";

export type Lang = "en" | "ar";

export type ErrorCode =
  | "INVALID_JSON"
  | "INVALID_REQUEST"
  | "MESSAGE_TOO_LONG"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "CONFIG_MISSING_KEYS"
  | "DB_UNAVAILABLE"
  | "DB_QUERY_FAILED"
  | "INDEX_MISSING"
  | "INDEX_CORRUPT"
  | "EMBEDDING_FAILED"
  | "TOOL_FAILED"
  | "LLM_AUTH"
  | "LLM_RATE_LIMIT"
  | "LLM_QUOTA"
  | "LLM_TIMEOUT"
  | "LLM_OVERLOADED"
  | "LLM_NETWORK"
  | "LLM_CONTEXT_LENGTH"
  | "LLM_CONTENT_BLOCKED"
  | "LLM_BAD_REQUEST"
  | "LLM_EMPTY_RESPONSE"
  | "AGENT_LOOP_LIMIT"
  | "REQUEST_TIMEOUT"
  | "CLIENT_ABORTED"
  | "INTERNAL";

interface ErrorSpec {
  status: number;
  retryable: boolean;
  en: string;
  ar: string;
}

// Every user-facing message carries the emergency line: this is a health product,
// so a failure must never leave someone with a possible emergency without guidance.
const EMERGENCY_EN = " If this is an emergency, contact local emergency services or go to the nearest emergency department now.";
const EMERGENCY_AR = " إذا كانت حالة طارئة، اتصل بخدمات الطوارئ المحلية أو توجه إلى أقرب قسم طوارئ فورًا.";

const SPECS: Record<ErrorCode, ErrorSpec> = {
  INVALID_JSON: { status: 400, retryable: false, en: "The request body is not valid JSON.", ar: "محتوى الطلب ليس JSON صالحًا." },
  INVALID_REQUEST: { status: 400, retryable: false, en: "The request is missing or has invalid fields.", ar: "الطلب ناقص أو يحتوي على حقول غير صالحة." },
  MESSAGE_TOO_LONG: { status: 413, retryable: false, en: "Your message is too long. Please shorten it.", ar: "رسالتك طويلة جدًا. يرجى اختصارها." },
  PAYLOAD_TOO_LARGE: { status: 413, retryable: false, en: "The request is too large.", ar: "الطلب كبير جدًا." },
  RATE_LIMITED: { status: 429, retryable: true, en: "Too many requests. Please wait a moment and try again.", ar: "طلبات كثيرة جدًا. يرجى الانتظار قليلًا ثم المحاولة مرة أخرى." },
  CONFIG_MISSING_KEYS: { status: 503, retryable: false, en: "The assistant is not configured yet.", ar: "المساعد غير مهيأ بعد." },
  DB_UNAVAILABLE: { status: 503, retryable: true, en: "The provider database is unavailable right now.", ar: "قاعدة بيانات مقدمي الرعاية غير متاحة حاليًا." },
  DB_QUERY_FAILED: { status: 500, retryable: true, en: "The provider search failed.", ar: "فشل البحث عن مقدمي الرعاية." },
  INDEX_MISSING: { status: 503, retryable: false, en: "The provider search index is missing.", ar: "فهرس البحث عن مقدمي الرعاية غير موجود." },
  INDEX_CORRUPT: { status: 503, retryable: false, en: "The provider search index is invalid.", ar: "فهرس البحث عن مقدمي الرعاية غير صالح." },
  EMBEDDING_FAILED: { status: 503, retryable: true, en: "Semantic search is unavailable right now.", ar: "البحث الدلالي غير متاح حاليًا." },
  TOOL_FAILED: { status: 500, retryable: true, en: "A tool used by the assistant failed.", ar: "فشلت أداة يستخدمها المساعد." },
  LLM_AUTH: { status: 503, retryable: false, en: "The assistant cannot reach its language model (authentication problem).", ar: "لا يستطيع المساعد الوصول إلى النموذج اللغوي (مشكلة مصادقة)." },
  LLM_RATE_LIMIT: { status: 429, retryable: true, en: "The assistant is busy. Please try again in a few seconds.", ar: "المساعد مشغول. يرجى المحاولة بعد ثوانٍ." },
  LLM_QUOTA: { status: 503, retryable: false, en: "The assistant's usage quota is exhausted.", ar: "تم استنفاد حصة استخدام المساعد." },
  LLM_TIMEOUT: { status: 504, retryable: true, en: "The assistant took too long to respond. Please try again.", ar: "استغرق المساعد وقتًا طويلًا للرد. يرجى المحاولة مرة أخرى." },
  LLM_OVERLOADED: { status: 503, retryable: true, en: "The language model is overloaded. Please try again shortly.", ar: "النموذج اللغوي مثقل بالطلبات. يرجى المحاولة بعد قليل." },
  LLM_NETWORK: { status: 502, retryable: true, en: "Network problem while contacting the language model.", ar: "مشكلة في الشبكة أثناء الاتصال بالنموذج اللغوي." },
  LLM_CONTEXT_LENGTH: { status: 413, retryable: false, en: "This conversation is too long. Please start a new one.", ar: "المحادثة طويلة جدًا. يرجى بدء محادثة جديدة." },
  LLM_CONTENT_BLOCKED: { status: 422, retryable: false, en: "The request was blocked by the model's safety filter. Please rephrase.", ar: "تم حظر الطلب بواسطة مرشح الأمان. يرجى إعادة الصياغة." },
  LLM_BAD_REQUEST: { status: 502, retryable: false, en: "The language model rejected the request.", ar: "رفض النموذج اللغوي الطلب." },
  LLM_EMPTY_RESPONSE: { status: 502, retryable: true, en: "The assistant returned an empty response. Please try again.", ar: "أعاد المساعد ردًا فارغًا. يرجى المحاولة مرة أخرى." },
  AGENT_LOOP_LIMIT: { status: 500, retryable: true, en: "The assistant could not finish this request. Please rephrase and try again.", ar: "لم يتمكن المساعد من إكمال هذا الطلب. يرجى إعادة الصياغة والمحاولة." },
  REQUEST_TIMEOUT: { status: 504, retryable: true, en: "The request timed out. Please try again.", ar: "انتهت مهلة الطلب. يرجى المحاولة مرة أخرى." },
  CLIENT_ABORTED: { status: 499, retryable: false, en: "The request was cancelled.", ar: "تم إلغاء الطلب." },
  INTERNAL: { status: 500, retryable: true, en: "Something went wrong on our side.", ar: "حدث خطأ من جانبنا." },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly retryAfterSec?: number;

  constructor(code: ErrorCode, opts: { cause?: unknown; detail?: string; retryAfterSec?: number } = {}) {
    super(opts.detail ?? SPECS[code].en, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.status = SPECS[code].status;
    this.retryable = SPECS[code].retryable;
    this.retryAfterSec = opts.retryAfterSec;
  }

  userMessage(lang: Lang): string {
    const spec = SPECS[this.code];
    const base = lang === "ar" ? spec.ar : spec.en;
    if (NO_SAFETY_LINE.has(this.code)) return base;
    return base + (lang === "ar" ? EMERGENCY_AR : EMERGENCY_EN);
  }
}

const NO_SAFETY_LINE = new Set<ErrorCode>(["INVALID_JSON", "INVALID_REQUEST", "MESSAGE_TOO_LONG", "PAYLOAD_TOO_LARGE", "CLIENT_ABORTED"]);

/** The error itself plus its `.cause` chain (LangChain middleware wraps provider errors and drops their status). */
function chainOf(err: unknown): unknown[] {
  const out: unknown[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur != null; i++) {
    out.push(cur);
    cur = (cur as { cause?: unknown })?.cause;
  }
  return out;
}

function statusOf(err: unknown): number | undefined {
  for (const link of chainOf(err)) {
    const e = link as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null;
    for (const v of [e?.status, e?.statusCode, e?.response?.status]) {
      if (typeof v === "number") return v;
    }
  }
  const m = /\b(?:status|code)?[\s:\[(]*(4\d\d|5\d\d)\b/.exec(String((err as Error)?.message ?? ""));
  return m ? Number(m[1]) : undefined;
}

function retryAfterOf(err: unknown): number | undefined {
  for (const link of chainOf(err)) {
    const h = (link as { headers?: Record<string, string> | Headers } | null)?.headers;
    const raw = h instanceof Headers ? h.get("retry-after") : h?.["retry-after"];
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n)) return Math.min(Math.max(n, 1), 120);
  }
  return undefined;
}

/** Map anything thrown anywhere in the stack to a typed AppError. Never throws. */
export function classifyError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  const name = (err as Error)?.name ?? "";
  const causeNames = chainOf(err).map((e) => (e as Error)?.name);
  const msg = String((err as Error)?.message ?? err ?? "");
  const lower = msg.toLowerCase();
  const code = (err as { code?: unknown })?.code;
  const status = statusOf(err);
  const opts = { cause: err, retryAfterSec: retryAfterOf(err) };

  if (err instanceof GraphRecursionError || causeNames.includes("GraphRecursionError")) return new AppError("AGENT_LOOP_LIMIT", opts);
  if (causeNames.includes("TimeoutError") || /timed? ?out|timeout|deadline exceeded|ETIMEDOUT/i.test(msg)) {
    // An abort raised by AbortSignal.timeout surfaces as TimeoutError.
    return new AppError("LLM_TIMEOUT", opts);
  }
  if (causeNames.includes("AbortError") || code === "ABORT_ERR") return new AppError("CLIENT_ABORTED", opts);

  if (/(received empty response|empty response from chat model|no chunks returned)/i.test(msg)) return new AppError("LLM_EMPTY_RESPONSE", opts);
  if (/(safety|blocked|prohibited_content|content[_ ]filter|harm_category|recitation)/i.test(msg) && !/rate/i.test(msg)) {
    return new AppError("LLM_CONTENT_BLOCKED", opts);
  }
  if (/(context length|context_length|maximum context|too many tokens|token limit|prompt is too long|request too large)/i.test(lower)) {
    return new AppError("LLM_CONTEXT_LENGTH", opts);
  }
  if (/(insufficient_quota|billing_hard_limit|credit balance|payment required)/i.test(lower) || status === 402) {
    return new AppError("LLM_QUOTA", opts);
  }

  if (status === 401 || status === 403) return new AppError("LLM_AUTH", opts);
  if (status === 429) return new AppError("LLM_RATE_LIMIT", opts);
  if (status === 408 || status === 504) return new AppError("LLM_TIMEOUT", opts);
  if (status === 413) return new AppError("LLM_CONTEXT_LENGTH", opts);
  if (status === 400 || status === 404 || status === 422) return new AppError("LLM_BAD_REQUEST", opts);
  if (status === 500 || status === 502 || status === 503 || status === 529) return new AppError("LLM_OVERLOADED", opts);

  if (typeof code === "string" && /^(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_.*)$/.test(code)) {
    return new AppError("LLM_NETWORK", opts);
  }
  if (/(fetch failed|network|socket hang up|connection (reset|refused|error))/i.test(msg)) {
    return new AppError("LLM_NETWORK", opts);
  }
  if (/overloaded|unavailable|high demand/i.test(lower)) return new AppError("LLM_OVERLOADED", opts);

  return new AppError("INTERNAL", opts);
}

/** Safe, non-sensitive description for logs. */
export function describeError(err: unknown): Record<string, unknown> {
  const e = classifyError(err);
  const cause = e.cause as Error | undefined;
  return {
    code: e.code,
    status: e.status,
    retryable: e.retryable,
    message: e.message,
    causeName: cause?.name,
    causeMessage: cause?.message?.slice(0, 500),
  };
}
