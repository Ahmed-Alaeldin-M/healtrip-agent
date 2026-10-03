import type { Lang, MessageError } from "./types";

const EMERGENCY = {
  en: " If this is an emergency, contact local emergency services or go to the nearest emergency department now.",
  ar: " إذا كانت حالة طارئة، اتصل بخدمات الطوارئ المحلية أو توجه إلى أقرب قسم طوارئ فورًا.",
};

const dict = {
  en: {
    newConversation: "New conversation",
    myHealth: "My health",
    medications: "Medications",
    comingSoon: "Coming soon",
    recent: "Recent",
    untitled: "New conversation",
    noRecent: "Your conversations will appear here.",
    closeMenu: "Close menu",
    openMenu: "Open menu",
    mainNav: "Main navigation",
    closeNav: "Close navigation",
    needSupport: "Need human support?",
    connectTeam: "Connect with our care team.",
    openSupport: "Open support",
    statusOnline: "Your health guide is online",
    statusDegraded: "Having trouble connecting",
    statusOffline: "You appear to be offline",
    switchLang: "Switch to Arabic",
    langButton: "عربي",
    options: "Conversation options",
    rename: "Rename conversation",
    renamePrompt: "Conversation name",
    delete: "Delete conversation",
    deleteConfirm: "Delete this conversation? This can't be undone.",
    deleteItem: "Delete",
    welcomeKicker: "Clear health guidance, when you need it",
    welcomeA: "How can I help you feel ",
    welcomeB: "better today?",
    welcomeCopy:
      "Ask about symptoms, medications, test results, or preparing for an appointment. I’ll help make health information easier to understand.",
    placeholder: "Ask a health question...",
    messageAria: "Message Healtrip Agent",
    attach: "Attachments aren’t available yet",
    send: "Send message",
    stop: "Stop",
    note: "Healtrip provides general information, not a diagnosis. For emergencies, contact local emergency services.",
    justNow: "Just now",
    thinking: "Healtrip is thinking",
    searching: "Searching providers…",
    stillWorking: "Still working on it…",
    retry: "Try again",
    retryIn: (s: number) => `Try again in ${s}s`,
    editResend: "Edit and resend",
    newChat: "Start a new chat",
    chatFull: "This conversation is full. Start a new chat to continue.",
    charsLeft: (n: number) => `${n} characters left`,
    offlineBanner: "You’re offline. Messages will fail until you reconnect.",
    storageFail: "Couldn’t save your chat history on this device. Recent chats may be lost when you close the page.",
    storagePruned: "Storage was full, so the oldest conversations were removed.",
    storageCorrupt: "Saved chat history was unreadable and has been reset.",
    syncedFromTab: "Updated from another tab.",
    dismiss: "Dismiss",
    assistantLabel: "Healtrip Agent",
    youLabel: "You",
    attempt: "Message failed",
  },
  ar: {
    newConversation: "محادثة جديدة",
    myHealth: "صحتي",
    medications: "الأدوية",
    comingSoon: "قريبًا",
    recent: "الأخيرة",
    untitled: "محادثة جديدة",
    noRecent: "ستظهر محادثاتك هنا.",
    closeMenu: "إغلاق القائمة",
    openMenu: "فتح القائمة",
    mainNav: "التنقل الرئيسي",
    closeNav: "إغلاق التنقل",
    needSupport: "هل تحتاج إلى دعم بشري؟",
    connectTeam: "تواصل مع فريق الرعاية.",
    openSupport: "فتح الدعم",
    statusOnline: "دليلك الصحي متصل الآن",
    statusDegraded: "نواجه مشكلة في الاتصال",
    statusOffline: "يبدو أنك غير متصل بالإنترنت",
    switchLang: "التبديل إلى الإنجليزية",
    langButton: "EN",
    options: "خيارات المحادثة",
    rename: "إعادة تسمية المحادثة",
    renamePrompt: "اسم المحادثة",
    delete: "حذف المحادثة",
    deleteConfirm: "هل تريد حذف هذه المحادثة؟ لا يمكن التراجع عن ذلك.",
    deleteItem: "حذف",
    welcomeKicker: "إرشادات صحية واضحة، وقتما تحتاجها",
    welcomeA: "كيف يمكنني مساعدتك لتشعر ",
    welcomeB: "بشكل أفضل اليوم؟",
    welcomeCopy:
      "اسأل عن الأعراض أو الأدوية أو نتائج الفحوصات أو كيفية الاستعداد لموعد طبي. سأساعدك في فهم المعلومات الصحية بسهولة.",
    placeholder: "اطرح سؤالاً صحياً...",
    messageAria: "مراسلة مساعد هيل تريب",
    attach: "المرفقات غير متاحة بعد",
    send: "إرسال الرسالة",
    stop: "إيقاف",
    note: "يقدم هيل تريب معلومات عامة وليس تشخيصاً طبياً. في حالات الطوارئ، تواصل مع خدمات الطوارئ المحلية.",
    justNow: "الآن",
    thinking: "هيل تريب يفكر",
    searching: "جارٍ البحث عن مقدمي الرعاية…",
    stillWorking: "ما زلنا نعمل على ذلك…",
    retry: "حاول مرة أخرى",
    retryIn: (s: number) => `حاول مرة أخرى بعد ${s} ث`,
    editResend: "تعديل وإعادة الإرسال",
    newChat: "ابدأ محادثة جديدة",
    chatFull: "هذه المحادثة ممتلئة. ابدأ محادثة جديدة للمتابعة.",
    charsLeft: (n: number) => `متبقي ${n} حرفًا`,
    offlineBanner: "أنت غير متصل. ستفشل الرسائل حتى تعود إلى الاتصال.",
    storageFail: "تعذر حفظ سجل المحادثات على هذا الجهاز. قد تفقد المحادثات الأخيرة عند إغلاق الصفحة.",
    storagePruned: "مساحة التخزين ممتلئة، لذلك تمت إزالة أقدم المحادثات.",
    storageCorrupt: "كان سجل المحادثات المحفوظ غير قابل للقراءة وتمت إعادة تعيينه.",
    syncedFromTab: "تم التحديث من علامة تبويب أخرى.",
    dismiss: "إغلاق",
    assistantLabel: "مساعد هيل تريب",
    youLabel: "أنت",
    attempt: "فشلت الرسالة",
  },
} as const;

export type Dict = (typeof dict)["en"];
export const strings = (lang: Lang): Dict => dict[lang] as unknown as Dict;

/** Errors created in the browser (the server localizes its own). */
const clientErrors: Record<string, { en: string; ar: string; retryable: boolean; emergency: boolean }> = {
  CLIENT_OFFLINE: { en: "You appear to be offline. Check your connection and try again.", ar: "يبدو أنك غير متصل بالإنترنت. تحقق من اتصالك وحاول مرة أخرى.", retryable: true, emergency: true },
  CLIENT_NETWORK: { en: "Couldn’t reach the server. Check your connection and try again.", ar: "تعذر الوصول إلى الخادم. تحقق من اتصالك وحاول مرة أخرى.", retryable: true, emergency: true },
  CLIENT_TIMEOUT: { en: "The assistant took too long to respond.", ar: "استغرق المساعد وقتًا طويلًا للرد.", retryable: true, emergency: true },
  CLIENT_BAD_RESPONSE: { en: "The server sent an unexpected response.", ar: "أرسل الخادم ردًا غير متوقع.", retryable: true, emergency: true },
  CLIENT_STREAM_INTERRUPTED: { en: "The connection dropped before the answer was complete.", ar: "انقطع الاتصال قبل اكتمال الإجابة.", retryable: true, emergency: true },
  CLIENT_ABORTED: { en: "Stopped.", ar: "تم الإيقاف.", retryable: true, emergency: false },
  INTERRUPTED: { en: "This message was interrupted before it finished.", ar: "تمت مقاطعة هذه الرسالة قبل اكتمالها.", retryable: true, emergency: false },
};

export function clientError(code: keyof typeof clientErrors | string, lang: Lang, extra?: { retryAt?: number }): MessageError {
  const spec = clientErrors[code] ?? clientErrors.CLIENT_BAD_RESPONSE!;
  const message = (lang === "ar" ? spec.ar : spec.en) + (spec.emergency ? EMERGENCY[lang] : "");
  return { code, message, retryable: spec.retryable, ...extra };
}

/** Interrupted messages were stored in English; show them in the current UI language. */
export function displayError(err: MessageError, lang: Lang): string {
  return err.code === "INTERRUPTED" ? clientError("INTERRUPTED", lang).message : err.message;
}

export function formatTime(ts: number, lang: Lang, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 60_000) return strings(lang).justNow;
  return new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }).format(ts);
}

export function formatRelative(ts: number, lang: Lang, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return strings(lang).justNow;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  const day = Math.floor(hr / 24);
  if (day < 30) return rtf.format(-day, "day");
  return new Intl.DateTimeFormat(lang, { dateStyle: "medium" }).format(ts);
}
