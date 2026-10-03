"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import { checkHealth, streamChat, type Health } from "@/lib/chat/client";
import { clientError, formatRelative, strings } from "@/lib/chat/i18n";
import { uuid } from "@/lib/chat/id";
import { buildHistory, byRecent, canSend, isFull, isPending, reducer } from "@/lib/chat/reducer";
import { ACTIVE_KEY, LANG_KEY, STORAGE_KEY, parseStored, safeStorage, saveConversations, serialize } from "@/lib/chat/storage";
import { MAX_INPUT_CHARS, initialState, type ChatMessage, type Lang } from "@/lib/chat/types";
import {
  ClipIcon, CloseIcon, DotsIcon, HealtripLogo, HeartIcon, MenuIcon, PillIcon, PlusIcon, SendIcon, Sparkle, StopIcon, TrashIcon,
} from "./icons";
import { MessageList } from "./Messages";

const suggestions = [
  { icon: "✦", en: ["Understand a symptom", "Talk through what you’re feeling", "I’d like help understanding a symptom"], ar: ["فهم أحد الأعراض", "تحدث عما تشعر به", "أود المساعدة في فهم أحد الأعراض"] },
  { icon: "⌁", en: ["Learn about medication", "Get clear, simple information", "I have a question about my medication"], ar: ["تعرّف على دوائك", "احصل على معلومات واضحة وبسيطة", "لدي سؤال عن دوائي"] },
  { icon: "↗", en: ["Prepare for an appointment", "Know what to ask your doctor", "Help me prepare for my next doctor’s appointment"], ar: ["استعد لموعدك الطبي", "اعرف ما الذي تسأل عنه طبيبك", "ساعدني في الاستعداد لموعدي الطبي القادم"] },
] as const;

type Notice = { id: number; text: string; tone: "warn" | "error" };

export default function ChatApp() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [lang, setLang] = useState<Lang>("en");
  const [draft, setDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [health, setHealth] = useState<Health>("online");
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [slow, setSlow] = useState(false);
  const [phase, setPhase] = useState<Record<string, string>>({});

  const t = strings(lang);
  const isArabic = lang === "ar";

  const stateRef = useRef(state);
  stateRef.current = state;
  const langRef = useRef(lang);
  langRef.current = lang;
  const controllers = useRef(new Map<string, AbortController>());
  const lastSerialized = useRef<string | null>(null);
  const warnedStorage = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef("");
  const stickToBottom = useRef(true);

  const active = useMemo(() => state.conversations.find((c) => c.id === state.activeId), [state.conversations, state.activeId]);
  const pending = isPending(active);
  const full = isFull(active);
  const hasMessages = (active?.messages.length ?? 0) > 0;

  const pushNotice = useCallback((text: string, tone: Notice["tone"] = "warn") => setNotice({ id: Date.now(), text, tone }), []);

  // ---- hydrate from storage (client only) ----
  useEffect(() => {
    const local = safeStorage("local");
    const session = safeStorage("session");
    let storedLang: string | null = null;
    try { storedLang = local?.getItem(LANG_KEY) ?? null; } catch { /* ignore */ }
    const nextLang: Lang = storedLang === "ar" || storedLang === "en" ? storedLang : navigator.language?.toLowerCase().startsWith("ar") ? "ar" : "en";
    setLang(nextLang);

    let raw: string | null = null;
    try { raw = local?.getItem(STORAGE_KEY) ?? null; } catch { /* ignore */ }
    const parsed = parseStored(raw);
    if (parsed.corrupt) {
      try { if (raw) local?.setItem(`${STORAGE_KEY}:corrupt`, raw.slice(0, 200_000)); } catch { /* ignore */ }
      pushNotice(strings(nextLang).storageCorrupt);
    } else if (!local) {
      warnedStorage.current = true;
      pushNotice(strings(nextLang).storageFail);
    }
    let activeId: string | undefined;
    try { activeId = session?.getItem(ACTIVE_KEY) ?? undefined; } catch { /* ignore */ }
    lastSerialized.current = raw;
    dispatch({ type: "hydrate", conversations: parsed.conversations, activeId, newId: uuid(), now: Date.now() });
    setOnline(navigator.onLine);

    const map = controllers.current;
    return () => map.forEach((c) => c.abort());
  }, [pushNotice]);

  // ---- persist (debounced; flushed when the page is hidden) ----
  const flush = useCallback(() => {
    const local = safeStorage("local");
    if (!local) return;
    const serialized = serialize(stateRef.current.conversations);
    if (serialized === lastSerialized.current) return;
    const res = saveConversations(local, stateRef.current.conversations);
    if (res.ok) {
      lastSerialized.current = res.serialized ?? serialized;
      if (res.pruned && !warnedStorage.current) {
        warnedStorage.current = true;
        pushNotice(strings(langRef.current).storagePruned);
      }
    } else if (!warnedStorage.current) {
      warnedStorage.current = true;
      pushNotice(strings(langRef.current).storageFail, "error");
    }
  }, [pushNotice]);

  useEffect(() => {
    if (!state.hydrated) return;
    const id = window.setTimeout(flush, 250);
    return () => window.clearTimeout(id);
  }, [state.conversations, state.hydrated, flush]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  // ---- per-tab active chat, language ----
  useEffect(() => {
    if (!state.hydrated || !state.activeId) return;
    try { safeStorage("session")?.setItem(ACTIVE_KEY, state.activeId); } catch { /* ignore */ }
  }, [state.activeId, state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) return;
    try { safeStorage("local")?.setItem(LANG_KEY, lang); } catch { /* ignore */ }
    document.documentElement.lang = lang;
    document.documentElement.dir = isArabic ? "rtl" : "ltr";
  }, [lang, isArabic, state.hydrated]);

  // ---- sync with other tabs ----
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== STORAGE_KEY) return;
      if (e.newValue === lastSerialized.current) return;
      lastSerialized.current = e.newValue;
      dispatch({ type: "sync", conversations: parseStored(e.newValue).conversations, newId: uuid(), now: Date.now() });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ---- connectivity + backend health ----
  useEffect(() => {
    let alive = true;
    const run = async () => { const h = await checkHealth(); if (alive) setHealth(h); };
    void run();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void run(); }, 60_000);
    const on = () => { setOnline(true); void run(); };
    const off = () => { setOnline(false); setHealth("offline"); };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // ---- "still working" hint ----
  useEffect(() => {
    setSlow(false);
    if (!pending) return;
    const id = window.setTimeout(() => setSlow(true), 12_000);
    return () => window.clearTimeout(id);
  }, [pending, state.activeId]);

  // ---- keep the latest message in view (but never yank the page while someone is reading above) ----
  useEffect(() => {
    const onScroll = () => {
      stickToBottom.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const lastMessage = active?.messages.at(-1);
  useEffect(() => {
    if (!state.hydrated || !active) return;
    const switched = scrolledFor.current !== active.id;
    scrolledFor.current = active.id;
    const ownMessage = lastMessage?.role === "user";
    if (!switched && !ownMessage && !stickToBottom.current) return;
    if (switched || ownMessage) stickToBottom.current = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const streaming = lastMessage?.status === "streaming";
    endRef.current?.scrollIntoView({ block: "end", behavior: switched || reduce || streaming ? "auto" : "smooth" });
  }, [active?.id, active?.messages.length, lastMessage?.content.length, lastMessage?.status, pending, state.hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- menus: outside click / Escape ----
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenuOpen(false); setSidebarOpen(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);

  // ---- sending ----
  const run = useCallback(async (convId: string, userMsg: ChatMessage, history: { role: "user" | "assistant"; content: string }[]) => {
    const ac = new AbortController();
    controllers.current.get(convId)?.abort();
    controllers.current.set(convId, ac);
    const language = langRef.current;
    const assistantId = uuid();

    // Tokens can arrive far faster than React needs to re-render markdown; coalesce into ~25 updates/second.
    let acc = "";
    let timer: number | undefined;
    const flushStream = () => {
      timer = undefined;
      dispatch({ type: "stream", convId, userId: userMsg.id, assistantId, content: acc, now: Date.now() });
    };
    const clearPhase = () => setPhase((p) => (convId in p ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== convId)) : p));

    const result = await streamChat({
      message: userMsg.content,
      language,
      threadId: convId,
      history,
      signal: ac.signal,
      handlers: {
        onDelta: (text) => {
          acc += text;
          clearPhase();
          if (timer === undefined) timer = window.setTimeout(flushStream, 40);
        },
        onReset: () => {
          acc = "";
          if (timer !== undefined) { window.clearTimeout(timer); timer = undefined; }
          dispatch({ type: "stream", convId, userId: userMsg.id, assistantId, content: "", now: Date.now() });
        },
        onStatus: (p) => setPhase((cur) => ({ ...cur, [convId]: p })),
      },
    });

    if (timer !== undefined) window.clearTimeout(timer);
    clearPhase();
    if (controllers.current.get(convId) === ac) controllers.current.delete(convId);
    if (result.ok) {
      dispatch({ type: "succeed", convId, userId: userMsg.id, reply: { id: assistantId, role: "assistant", content: result.answer, createdAt: Date.now(), status: "done" } });
    } else {
      dispatch({ type: "fail", convId, userId: userMsg.id, error: result.error });
    }
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const conv = stateRef.current.conversations.find((c) => c.id === stateRef.current.activeId);
    const text = draft.trim();
    if (!conv || !text || !canSend(conv)) return;
    if (text.length > MAX_INPUT_CHARS) return;
    if (!navigator.onLine) pushNotice(t.offlineBanner, "error");
    const userMsg: ChatMessage = { id: uuid(), role: "user", content: text, createdAt: Date.now(), status: "pending" };
    const history = buildHistory(conv);
    dispatch({ type: "send", convId: conv.id, message: userMsg });
    setDraft("");
    void run(conv.id, userMsg, history);
  }

  function retry(userId: string) {
    const conv = stateRef.current.conversations.find((c) => c.id === stateRef.current.activeId);
    const msg = conv?.messages.find((m) => m.id === userId);
    if (!conv || !msg || conv.messages.at(-1)?.id !== userId || !canSend(conv)) return;
    const history = buildHistory(conv, userId);
    dispatch({ type: "retry", convId: conv.id, userId });
    void run(conv.id, { ...msg, status: "pending" }, history);
  }

  function editAndResend(messageId: string) {
    const conv = stateRef.current.conversations.find((c) => c.id === stateRef.current.activeId);
    const msg = conv?.messages.find((m) => m.id === messageId);
    if (!conv || !msg) return;
    dispatch({ type: "removeMessage", convId: conv.id, messageId });
    setDraft(msg.content);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function stop() {
    if (active) controllers.current.get(active.id)?.abort();
  }

  function newChat() {
    dispatch({ type: "new", id: uuid(), now: Date.now() });
    setSidebarOpen(false);
    setMenuOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function selectChat(id: string) {
    dispatch({ type: "select", id });
    setSidebarOpen(false);
  }

  function deleteChat(id: string) {
    if (!window.confirm(t.deleteConfirm)) return;
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    dispatch({ type: "delete", id, newId: uuid(), now: Date.now() });
    setMenuOpen(false);
  }

  function renameChat() {
    if (!active) return;
    setMenuOpen(false);
    const next = window.prompt(t.renamePrompt, active.title);
    if (next !== null) dispatch({ type: "rename", id: active.id, title: next });
  }

  function chooseSuggestion(prompt: string) {
    setDraft(prompt);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  const recent = useMemo(() => state.conversations.filter((c) => c.messages.length > 0).sort(byRecent), [state.conversations]);
  const status: Health = !online ? "offline" : health;
  const statusText = status === "online" ? t.statusOnline : status === "offline" ? t.statusOffline : t.statusDegraded;
  const remaining = MAX_INPUT_CHARS - draft.length;
  const navItems = [
    { label: t.newConversation, icon: <PlusIcon />, onClick: newChat, active: !hasMessages, soon: false },
  ];

  return (
    <main className="app-shell" data-hydrated={state.hydrated} dir={isArabic ? "rtl" : "ltr"} lang={lang}>
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div>
          <div className="sidebar-heading">
            <HealtripLogo />
            <button aria-label={t.closeMenu} className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} type="button"><CloseIcon /></button>
          </div>

          <nav aria-label={t.mainNav} className="primary-nav">
            {navItems.map((item) => (
              <button
                aria-disabled={item.soon || undefined}
                className={`nav-item ${item.active ? "nav-item-active" : ""}`}
                key={item.label}
                onClick={item.soon ? undefined : item.onClick}
                title={item.soon ? t.comingSoon : undefined}
                type="button"
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
                {item.soon && <span className="nav-soon">{t.comingSoon}</span>}
              </button>
            ))}
          </nav>

          <div className="recent-section">
            <p className="eyebrow">{t.recent}</p>
            <div className="recent-list">
              {recent.length === 0 && <p className="recent-empty">{t.noRecent}</p>}
              {recent.map((c) => (
                <div className="recent-row" key={c.id}>
                  <button aria-current={c.id === state.activeId ? "true" : undefined} className={`recent-item ${c.id === state.activeId ? "is-active" : ""}`} onClick={() => selectChat(c.id)} type="button">
                    <span dir="auto">{c.title || t.untitled}</span>
                    <small>
                      {isPending(c) && <i className="busy-dot" />}
                      {formatRelative(c.updatedAt, lang)}
                    </small>
                  </button>
                  <button aria-label={`${t.deleteItem}: ${c.title || t.untitled}`} className="recent-delete" onClick={() => deleteChat(c.id)} type="button"><TrashIcon /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="support-card">
            <div className="support-icon"><Sparkle /></div>
            <div>
              <p>{t.needSupport}</p>
              <span>{t.connectTeam}</span>
            </div>
            <button aria-label={t.openSupport} className="support-arrow" type="button">↗</button>
          </div>
        </div>
      </aside>

      {sidebarOpen && <button aria-label={t.closeNav} className="sidebar-scrim" onClick={() => setSidebarOpen(false)} type="button" />}

      <section className="chat-area">
        <header className="topbar">
          <button aria-label={t.openMenu} className="icon-button menu-button" onClick={() => setSidebarOpen(true)} type="button"><MenuIcon /></button>
          <div className="mobile-brand"><HealtripLogo compact /></div>
          <div className="agent-status">
            <span className="agent-avatar"><Sparkle /></span>
            <div>
              <strong>Healtrip Agent</strong>
              <span aria-live="polite"><i className={status === "online" ? "" : `is-${status}`} /> {statusText}</span>
            </div>
          </div>
          <button aria-label={t.switchLang} className="language-toggle" onClick={() => setLang(isArabic ? "en" : "ar")} type="button">{t.langButton}</button>
          <div className="options-wrap" ref={menuRef}>
            <button aria-expanded={menuOpen} aria-haspopup="menu" aria-label={t.options} className="icon-button" onClick={() => setMenuOpen((v) => !v)} type="button"><DotsIcon /></button>
            {menuOpen && (
              <div className="menu" role="menu">
                <button disabled={!hasMessages} onClick={renameChat} role="menuitem" type="button">{t.rename}</button>
                <button className="danger" disabled={!hasMessages} onClick={() => active && deleteChat(active.id)} role="menuitem" type="button">{t.delete}</button>
              </div>
            )}
          </div>
        </header>

        <div className={`conversation ${hasMessages ? "has-messages" : ""}`}>
          {!hasMessages && (
            <>
              <div className="welcome">
                <div className="welcome-symbol"><Sparkle /><span className="mini-star">✦</span></div>
                <p className="welcome-kicker">{t.welcomeKicker}</p>
                <h1>{t.welcomeA}<em>{t.welcomeB}</em></h1>
                <p className="welcome-copy">{t.welcomeCopy}</p>
              </div>
              <div className="suggestion-grid">
                {suggestions.map((s) => {
                  const [title, copy, prompt] = isArabic ? s.ar : s.en;
                  return (
                    <button className="suggestion-card" key={s.en[0]} onClick={() => chooseSuggestion(prompt)} type="button">
                      <span className="suggestion-icon">{s.icon}</span>
                      <span className="suggestion-content"><strong>{title}</strong><small>{copy}</small></span>
                      <span className="card-arrow">→</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {active && hasMessages && (
            <MessageList
              chatFull={full}
              lang={lang}
              messages={active.messages}
              onEdit={editAndResend}
              onNewChat={newChat}
              onRetry={retry}
              pending={pending}
              phase={phase[active.id]}
              slow={slow}
            />
          )}
          <div ref={endRef} style={{ scrollMarginBottom: 150 }} />
        </div>

        <div className="composer-wrap">
          {!online && <div className="notice is-error" role="status"><p>{t.offlineBanner}</p></div>}
          {notice && (
            <div className={`notice ${notice.tone === "error" ? "is-error" : ""}`} role="status">
              <p>{notice.text}</p>
              <button onClick={() => setNotice(null)} type="button">{t.dismiss}</button>
            </div>
          )}
          {full && (
            <div className="notice" role="status">
              <p>{t.chatFull}</p>
              <button onClick={newChat} type="button">{t.newChat}</button>
            </div>
          )}
          <form className="composer" onSubmit={submit}>
            <button aria-label={t.attach} className="composer-button" disabled title={t.attach} type="button"><ClipIcon /></button>
            <input
              aria-label={t.messageAria}
              autoComplete="off"
              disabled={full}
              enterKeyHint="send"
              id="chat-message"
              maxLength={MAX_INPUT_CHARS}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={full ? t.chatFull : t.placeholder}
              ref={inputRef}
              type="text"
              value={draft}
            />
            {pending ? (
              <button aria-label={t.stop} className="send-button is-stop" onClick={stop} title={t.stop} type="button"><StopIcon /></button>
            ) : (
              <button aria-label={t.send} className="send-button" disabled={!draft.trim() || full} type="submit"><SendIcon /></button>
            )}
          </form>
          {remaining <= 300 && <p className={`char-count ${remaining <= 50 ? "is-low" : ""}`}>{t.charsLeft(remaining)}</p>}
          <p className="composer-note">{t.note}</p>
        </div>
      </section>
    </main>
  );
}
