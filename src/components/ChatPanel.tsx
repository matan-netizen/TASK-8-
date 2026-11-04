"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage, Role } from "@/lib/types";
import { api, formatDate } from "@/lib/client";
import { Card, ErrorBox, Spinner, inputClass, primaryBtn } from "./ui";

const SUGGESTIONS: Record<Role, string[]> = {
  manager: ["מה חסר במשימה?", "איך לשפר את הניסוח?", "סכם לי את המשימה"],
  employee: ["מאיפה להתחיל?", "מה התוצר שצריך להגיש?", "עד מתי צריך לסיים?"],
};

export function ChatPanel({ taskId, role }: { taskId: string; role: Role }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingSeq = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await api<{ messages: ChatMessage[] }>(`/api/tasks/${taskId}/chat`);
      setMessages(r.messages);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [taskId]);

  useEffect(() => {
    // Initial data fetch on mount; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    setWarning(null);
    const optimistic: ChatMessage = {
      id: `pending-${++pendingSeq.current}`,
      taskId,
      channel: role,
      sender: "user",
      authorId: null,
      content: message,
      source: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...(m ?? []), optimistic]);
    setInput("");
    try {
      const r = await api<{ userMessage: ChatMessage; reply: ChatMessage; warning?: string }>(
        `/api/tasks/${taskId}/chat`,
        { body: { message } },
      );
      setMessages((m) => [...(m ?? []).filter((x) => x.id !== optimistic.id), r.userMessage, r.reply]);
      if (r.warning) setWarning(r.warning);
    } catch (e) {
      setMessages((m) => (m ?? []).filter((x) => x.id !== optimistic.id));
      setInput(message);
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(input);
  }

  return (
    <Card className="flex h-full min-h-[28rem] flex-col">
      <div className="mb-3">
        <h2 className="text-base font-semibold">צ&apos;אט חכם</h2>
        <p className="text-xs text-slate-500">
          {role === "manager"
            ? "חדדו ושפרו את המשימה לפני השיוך. השיחה גלויה רק לכם."
            : "שאלו שאלות על המשימה. העוזר מסביר ומייעץ, אך לא מבצע את העבודה בשבילכם."}
        </p>
      </div>

      <div
        ref={listRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-xl bg-slate-50 p-3"
        aria-live="polite"
      >
        {messages === null && !error && <Spinner />}
        {messages?.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">עדיין אין הודעות. אפשר להתחיל בשאלה.</p>
        )}
        {messages?.map((m) => (
          <div key={m.id} className={`flex ${m.sender === "user" ? "justify-start" : "justify-end"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
                m.sender === "user"
                  ? "rounded-ss-sm bg-indigo-600 text-white"
                  : "rounded-se-sm border border-slate-200 bg-white text-slate-800"
              }`}
            >
              <div
                className={`mb-1 text-[11px] font-semibold ${m.sender === "user" ? "text-indigo-100" : "text-violet-700"}`}
              >
                {m.sender === "user" ? "את/ה" : `עוזר AI${m.source === "demo" ? " · מצב הדגמה" : ""}`}
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
              <div
                className={`mt-1 text-[10px] ${m.sender === "user" ? "text-indigo-200" : "text-slate-400"}`}
              >
                {formatDate(m.createdAt)}
              </div>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-end">
            <div className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5">
              <Spinner label="העוזר כותב..." />
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {error && <ErrorBox message={error} onRetry={messages === null ? load : undefined} />}
        {warning && <p className="text-xs text-amber-700">{warning}</p>}
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS[role].map((s) => (
            <button
              key={s}
              type="button"
              disabled={sending}
              onClick={() => send(s)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={onSubmit} className="flex gap-2">
          <label htmlFor={`chat-${taskId}`} className="sr-only">
            הודעה
          </label>
          <input
            id={`chat-${taskId}`}
            className={inputClass}
            value={input}
            maxLength={2000}
            onChange={(e) => setInput(e.target.value)}
            placeholder="כתבו הודעה..."
            disabled={sending}
          />
          <button type="submit" className={primaryBtn} disabled={sending || !input.trim()}>
            שליחה
          </button>
        </form>
      </div>
    </Card>
  );
}
