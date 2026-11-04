"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Task, User } from "@/lib/types";
import { api, formatDate, useSession } from "@/lib/client";
import {
  AppHeader,
  Card,
  EmptyState,
  ErrorBox,
  PriorityBadge,
  Spinner,
  StatusBadge,
  inputClass,
  primaryBtn,
} from "@/components/ui";
import { NotificationsBell } from "@/components/NotificationsBell";

export default function ManagerHome() {
  const router = useRouter();
  const { user, aiMode, logout } = useSession("manager");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [employees, setEmployees] = useState<User[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Task["status"]>("all");

  const load = useCallback(async () => {
    try {
      const [t, u] = await Promise.all([
        api<{ tasks: Task[] }>("/api/tasks"),
        api<{ users: User[] }>("/api/users"),
      ]);
      setTasks(t.tasks);
      setEmployees(u.users.filter((x) => x.role === "employee"));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Initial data fetch on mount; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) load();
  }, [user, load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (description.trim().length < 3) {
      setCreateError("תיאור המשימה קצר מדי");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const r = await api<{ task: Task; warning?: string }>("/api/tasks", {
        body: { description },
      });
      router.push(`/manager/tasks/${r.task.id}${r.warning ? "?warn=1" : ""}`);
    } catch (err) {
      setCreateError((err as Error).message);
      setCreating(false);
    }
  }

  const nameOf = (id: string | null) => employees.find((e) => e.id === id)?.name ?? "—";
  const shown = tasks?.filter((t) => filter === "all" || t.status === filter);

  return (
    <>
      <AppHeader
        user={user}
        aiMode={aiMode}
        onLogout={logout}
        homeHref="/manager"
        extra={user && <NotificationsBell onNew={load} />}
      />
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        <Card>
          <h1 className="text-lg font-semibold">משימה חדשה</h1>
          <p className="mb-3 text-sm text-slate-500">
            כתבו תיאור קצר ולא פורמלי. ה-AI ינסח ממנו משימה ברורה, ותוכלו לערוך לפני השיוך לעובד.
          </p>
          <form onSubmit={onCreate} className="space-y-3">
            <label htmlFor="desc" className="sr-only">
              תיאור המשימה
            </label>
            <textarea
              id="desc"
              rows={3}
              maxLength={4000}
              className={inputClass}
              placeholder='לדוגמה: "תכין דוח מכירות של הרבעון האחרון עד יום חמישי, דחוף"'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={creating}
            />
            {createError && <ErrorBox message={createError} />}
            <div className="flex items-center gap-3">
              <button type="submit" className={primaryBtn} disabled={creating || !description.trim()}>
                {creating ? "מנתח את הבקשה..." : "ניתוח ויצירת משימה"}
              </button>
              {creating && <Spinner label="ה-AI מנסח את המשימה" />}
            </div>
          </form>
        </Card>

        <Card>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">המשימות שלי</h2>
            <div className="ms-auto flex gap-1 text-sm" role="tablist">
              {(
                [
                  ["all", "הכל"],
                  ["draft", "טיוטות"],
                  ["assigned", "בביצוע"],
                  ["completed", "בוצעו"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={filter === k}
                  onClick={() => setFilter(k)}
                  className={`rounded-lg px-3 py-1 ${filter === k ? "bg-indigo-600 text-white" : "hover:bg-slate-100"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {loadError && <ErrorBox message={loadError} onRetry={load} />}
          {!tasks && !loadError && <Spinner />}
          {shown && shown.length === 0 && (
            <EmptyState>{tasks?.length ? "אין משימות בסינון זה." : "עדיין לא נוצרו משימות. צרו את הראשונה למעלה."}</EmptyState>
          )}
          {shown && shown.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {shown.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/manager/tasks/${t.id}`}
                    className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.title}</div>
                      <div className="text-xs text-slate-500">
                        עובד: {nameOf(t.assigneeId)} · נוצרה {formatDate(t.createdAt)}
                        {t.deadline && ` · מועד: ${t.deadline}`}
                      </div>
                    </div>
                    <PriorityBadge priority={t.priority} />
                    <StatusBadge status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}
