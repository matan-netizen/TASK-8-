"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { AiSource, Priority, TaskStatus, User } from "@/lib/types";
import { PRIORITY_LABEL, STATUS_LABEL, STATUS_STYLE } from "@/lib/client";

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority) return null;
  const style =
    priority === "high"
      ? "bg-red-50 text-red-700 ring-red-200"
      : priority === "medium"
        ? "bg-sky-50 text-sky-700 ring-sky-200"
        : "bg-slate-50 text-slate-600 ring-slate-200";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${style}`}>
      עדיפות {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function AiModeBadge({ mode }: { mode: AiSource | null }) {
  if (!mode) return null;
  return mode === "demo" ? (
    <span
      className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900"
      title="לא הוגדר ANTHROPIC_API_KEY — התשובות נוצרות באופן דטרמיניסטי"
    >
      מצב הדגמה (ללא AI)
    </span>
  ) : (
    <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-900">
      AI פעיל (Claude)
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </section>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {message}
      {onRetry && (
        <button onClick={onRetry} className="ms-3 font-medium underline">
          נסו שוב
        </button>
      )}
    </div>
  );
}

export function Spinner({ label = "טוען..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      {label}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
      {children}
    </div>
  );
}

export function AppHeader({
  user,
  aiMode,
  onLogout,
  homeHref,
  extra,
}: {
  user: User | null;
  aiMode: AiSource | null;
  onLogout: () => void;
  homeHref: string;
  extra?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <Link href={homeHref} className="text-lg font-bold text-indigo-700">
          משימה 8
        </Link>
        <AiModeBadge mode={aiMode} />
        <div className="ms-auto flex items-center gap-3">
          {extra}
          {user && (
            <span className="text-sm text-slate-700">
              {user.name}{" "}
              <span className="text-xs text-slate-500">
                ({user.role === "manager" ? "מנהל" : "עובד"} · משתמש דמו)
              </span>
            </span>
          )}
          <button
            onClick={onLogout}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            החלפת משתמש
          </button>
        </div>
      </div>
    </header>
  );
}

export const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50";

export const primaryBtn =
  "rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryBtn =
  "rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

/** Titles of knowledge-base documents used as context (never their content). */
export function SourcesList({
  sources,
  label = "מקורות ממאגר המידע",
  compact = false,
}: {
  sources: { docId: string; title: string; project: string }[] | undefined;
  label?: string;
  compact?: boolean;
}) {
  if (!sources?.length) return null;
  return (
    <div className={compact ? "mt-2 border-t border-slate-100 pt-1.5" : ""}>
      <div className={`font-medium text-slate-500 ${compact ? "text-[10px]" : "text-sm"}`}>📚 {label}</div>
      <ul className={`flex flex-wrap gap-1.5 ${compact ? "mt-1" : "mt-1.5"}`}>
        {sources.map((s) => (
          <li
            key={s.docId}
            title={s.project}
            className={`rounded-md bg-violet-50 text-violet-800 ring-1 ring-violet-200 ${compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs"}`}
          >
            {s.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
