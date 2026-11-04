"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Notification } from "@/lib/types";
import { api, formatDate } from "@/lib/client";

const POLL_MS = 5000;

/** Manager notifications with polling and a visible toast for new "בוצע!" alerts. */
export function NotificationsBell({ onNew }: { onNew?: () => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Notification | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ notifications: Notification[] }>("/api/notifications");
      setItems(r.notifications);
      if (seen.current === null) {
        seen.current = new Set(r.notifications.map((n) => n.id));
        return;
      }
      const fresh = r.notifications.filter((n) => !seen.current!.has(n.id));
      fresh.forEach((n) => seen.current!.add(n.id));
      if (fresh.length) {
        setToast(fresh[0]);
        onNew?.();
      }
    } catch {
      // Polling errors are transient; the next tick retries.
    }
  }, [onNew]);

  useEffect(() => {
    // Initial data fetch on mount; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const unread = items.filter((n) => !n.read).length;

  async function markAll() {
    await api("/api/notifications/read", { body: {} }).catch(() => undefined);
    load();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
        aria-label={`התראות${unread ? ` (${unread} חדשות)` : ""}`}
      >
        🔔 התראות
        {unread > 0 && (
          <span className="absolute -top-2 -start-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute end-0 z-30 mt-2 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-sm font-semibold">התראות</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-xs text-indigo-700 hover:underline">
                סימון הכל כנקרא
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-500">אין התראות</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/manager/tasks/${n.taskId}`}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${n.read ? "text-slate-500" : "font-semibold text-slate-900"}`}
                  >
                    <span className="text-emerald-700">{n.message}</span>
                    <span className="block text-xs font-normal text-slate-500">
                      משימה הושלמה · {formatDate(n.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 start-6 z-40 rounded-xl bg-emerald-600 px-5 py-3 text-white shadow-xl"
        >
          <div className="text-lg font-bold">{toast.message}</div>
          <Link href={`/manager/tasks/${toast.taskId}`} className="text-sm underline">
            לצפייה במשימה
          </Link>
        </div>
      )}
    </div>
  );
}
