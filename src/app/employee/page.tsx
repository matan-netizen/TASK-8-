"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { EmployeeTaskView } from "@/lib/types";
import { api, formatDate, useSession } from "@/lib/client";
import { AppHeader, Card, EmptyState, ErrorBox, PriorityBadge, Spinner, StatusBadge } from "@/components/ui";

export default function EmployeeHome() {
  const { user, aiMode, logout } = useSession("employee");
  const [tasks, setTasks] = useState<EmployeeTaskView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ tasks: EmployeeTaskView[] }>("/api/tasks");
      setTasks(r.tasks);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Initial data fetch on mount; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) load();
  }, [user, load]);

  const open = tasks?.filter((t) => t.status !== "completed") ?? [];
  const done = tasks?.filter((t) => t.status === "completed") ?? [];

  const list = (items: EmployeeTaskView[]) => (
    <ul className="divide-y divide-slate-100">
      {items.map((t) => (
        <li key={t.id}>
          <Link
            href={`/employee/tasks/${t.id}`}
            className="flex flex-wrap items-center gap-3 rounded-lg px-2 py-3 hover:bg-slate-50"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{t.title}</div>
              <div className="text-xs text-slate-500">
                שויכה {formatDate(t.assignedAt)}
                {t.deadline && ` · מועד: ${t.deadline}`}
              </div>
            </div>
            <PriorityBadge priority={t.priority} />
            <StatusBadge status={t.status} />
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <AppHeader user={user} aiMode={aiMode} onLogout={logout} homeHref="/employee" />
      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
        <Card>
          <div className="mb-3 flex items-center">
            <h1 className="text-lg font-semibold">המשימות שלי</h1>
            <button onClick={load} className="ms-auto text-sm text-indigo-700 hover:underline">
              רענון
            </button>
          </div>
          {error && <ErrorBox message={error} onRetry={load} />}
          {!tasks && !error && <Spinner />}
          {tasks && open.length === 0 && <EmptyState>אין משימות פתוחות כרגע 🎉</EmptyState>}
          {open.length > 0 && list(open)}
        </Card>
        {done.length > 0 && (
          <Card>
            <h2 className="mb-3 text-lg font-semibold">משימות שבוצעו</h2>
            {list(done)}
          </Card>
        )}
      </main>
    </>
  );
}
