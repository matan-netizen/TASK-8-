"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiSource, Priority, Role, TaskStatus, User } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "אין חיבור לשרת. בדקו את החיבור ונסו שוב.");
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "אירעה שגיאה. נסו שוב.");
  return data as T;
}

/** Loads the demo session and redirects to the role picker if the role does not match. */
export function useSession(role: Role) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [aiMode, setAiMode] = useState<AiSource | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api<{ user: User | null }>("/api/session"),
      api<{ aiMode: AiSource }>("/api/status"),
    ])
      .then(([s, st]) => {
        if (!alive) return;
        if (!s.user || s.user.role !== role) router.replace("/");
        else setUser(s.user);
        setAiMode(st.aiMode);
      })
      .catch(() => router.replace("/"));
    return () => {
      alive = false;
    };
  }, [role, router]);

  const logout = useCallback(async () => {
    await api("/api/session", { method: "DELETE" }).catch(() => undefined);
    router.replace("/");
  }, [router]);

  return { user, aiMode, logout };
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  draft: "טיוטה",
  assigned: "בביצוע",
  completed: "בוצעה",
};

export const STATUS_STYLE: Record<TaskStatus, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-300",
  assigned: "bg-amber-50 text-amber-800 ring-amber-300",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-300",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "נמוכה",
  medium: "בינונית",
  high: "גבוהה",
};

export function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" });
}
