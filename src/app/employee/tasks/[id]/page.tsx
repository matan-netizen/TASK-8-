"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { EmployeeTaskView } from "@/lib/types";
import { PRIORITY_LABEL, api, formatDate, useSession } from "@/lib/client";
import { AppHeader, Card, ErrorBox, SourcesList, Spinner, StatusBadge, primaryBtn, secondaryBtn } from "@/components/ui";
import { ChatPanel } from "@/components/ChatPanel";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold text-slate-500">{title}</h3>
      <div className="text-slate-800">{children}</div>
    </div>
  );
}

export default function EmployeeTaskPage() {
  const { id } = useParams<{ id: string }>();
  const { user, aiMode, logout } = useSession("employee");
  const [task, setTask] = useState<EmployeeTaskView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ task: EmployeeTaskView }>(`/api/tasks/${id}`);
      setTask(r.task);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    // Initial data fetch on mount; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) load();
  }, [user, load]);

  async function complete() {
    if (completing) return;
    setCompleting(true);
    setError(null);
    try {
      const r = await api<{ task: EmployeeTaskView }>(`/api/tasks/${id}/complete`, { body: {} });
      setTask(r.task);
      setConfirming(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCompleting(false);
    }
  }

  return (
    <>
      <AppHeader user={user} aiMode={aiMode} onLogout={logout} homeHref="/employee" />
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <Link href="/employee" className="text-sm text-indigo-700 hover:underline">
          → חזרה למשימות שלי
        </Link>
        {loadError && (
          <div className="mt-4">
            <ErrorBox message={loadError} onRetry={load} />
          </div>
        )}
        {!task && !loadError && (
          <div className="mt-6">
            <Spinner />
          </div>
        )}
        {task && (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_24rem]">
            <Card className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-bold">{task.title}</h1>
                <StatusBadge status={task.status} />
              </div>
              <div className="flex flex-wrap gap-4 rounded-lg bg-slate-50 p-3 text-sm">
                <span>
                  <strong>מועד יעד:</strong> {task.deadline ?? "לא צוין"}
                </span>
                <span>
                  <strong>עדיפות:</strong> {task.priority ? PRIORITY_LABEL[task.priority] : "לא צוינה"}
                </span>
                <span>
                  <strong>שויכה:</strong> {formatDate(task.assignedAt)}
                </span>
              </div>
              <Section title="מטרה">
                <p className="whitespace-pre-wrap">{task.objective}</p>
              </Section>
              <Section title="הנחיות">
                <p className="whitespace-pre-wrap">{task.instructions}</p>
              </Section>
              {task.steps.length > 0 && (
                <Section title="שלבים מוצעים">
                  <ol className="list-decimal space-y-1 ps-5">
                    {task.steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ol>
                </Section>
              )}
              <Section title="תוצר מצופה">
                <p className="whitespace-pre-wrap">{task.deliverable}</p>
              </Section>
              <SourcesList sources={task.knowledgeSources} label="חומרי רקע במאגר המידע" />

              <div className="border-t border-slate-100 pt-4">
                {error && (
                  <div className="mb-3">
                    <ErrorBox message={error} />
                  </div>
                )}
                {task.status === "completed" ? (
                  <p className="rounded-lg bg-emerald-50 p-3 font-semibold text-emerald-800">
                    ✓ המשימה סומנה כבוצעה ({formatDate(task.completedAt)}). המנהל קיבל התראה.
                  </p>
                ) : confirming ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm">לסמן את המשימה כבוצעה ולעדכן את המנהל?</span>
                    <button onClick={complete} className={primaryBtn} disabled={completing}>
                      {completing ? "מעדכן..." : "כן, בוצע"}
                    </button>
                    <button onClick={() => setConfirming(false)} className={secondaryBtn} disabled={completing}>
                      ביטול
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirming(true)} className={primaryBtn}>
                    סמן כבוצעה
                  </button>
                )}
              </div>
            </Card>
            <div className="lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
              <ChatPanel taskId={task.id} role="employee" />
            </div>
          </div>
        )}
      </main>
    </>
  );
}
