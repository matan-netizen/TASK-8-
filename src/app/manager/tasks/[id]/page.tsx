"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import type { Priority, Task, User } from "@/lib/types";
import { api, formatDate, useSession } from "@/lib/client";
import {
  AppHeader,
  Card,
  ErrorBox,
  Spinner,
  SourcesList,
  StatusBadge,
  inputClass,
  primaryBtn,
  secondaryBtn,
} from "@/components/ui";
import { ManagerNav } from "@/components/ManagerNav";
import { ChatPanel } from "@/components/ChatPanel";

type Form = {
  title: string;
  objective: string;
  instructions: string;
  steps: string;
  deliverable: string;
  deadline: string;
  priority: Priority | "";
  clarificationQuestions: string;
  managerNotes: string;
  projectId: string;
};

const toForm = (t: Task): Form => ({
  title: t.title,
  objective: t.objective,
  instructions: t.instructions,
  steps: t.steps.join("\n"),
  deliverable: t.deliverable,
  deadline: t.deadline ?? "",
  priority: t.priority ?? "",
  clarificationQuestions: t.clarificationQuestions.join("\n"),
  managerNotes: t.managerNotes,
  projectId: t.projectId ?? "",
});

const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      {children}
    </label>
  );
}

function ManagerTaskPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const { user, aiMode, logout } = useSession("manager");
  const [task, setTask] = useState<Task | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [employees, setEmployees] = useState<User[]>([]);
  const [assignee, setAssignee] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [projects, setProjects] = useState<{ name: string; docs: number }[]>([]);

  const load = useCallback(async () => {
    try {
      const [t, u] = await Promise.all([
        api<{ task: Task }>(`/api/tasks/${id}`),
        api<{ users: User[] }>("/api/users"),
      ]);
      setTask(t.task);
      setForm(toForm(t.task));
      setDirty(false);
      setAssignee(t.task.assigneeId ?? "");
      setEmployees(u.users.filter((x) => x.role === "employee"));
      setLoadError(null);
      api<{ projects: { name: string; docs: number }[] }>("/api/knowledge/projects")
        .then((k) => setProjects(k.projects))
        .catch(() => undefined);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    // Initial data fetch on mount; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) load();
  }, [user, load]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setDirty(true);
    setNotice(null);
  };

  async function save(): Promise<boolean> {
    if (!form) return false;
    if (!form.title.trim() || !form.objective.trim() || !form.instructions.trim() || !form.deliverable.trim()) {
      setError("יש למלא כותרת, מטרה, הנחיות ותוצר");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await api<{ task: Task }>(`/api/tasks/${id}`, {
        method: "PATCH",
        body: {
          title: form.title,
          objective: form.objective,
          instructions: form.instructions,
          steps: lines(form.steps),
          deliverable: form.deliverable,
          deadline: form.deadline.trim() || null,
          priority: form.priority || null,
          clarificationQuestions: lines(form.clarificationQuestions),
          managerNotes: form.managerNotes,
          projectId: form.projectId || null,
        },
      });
      setTask(r.task);
      setForm(toForm(r.task));
      setDirty(false);
      setNotice("השינויים נשמרו");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function assign() {
    if (!assignee) {
      setError("יש לבחור עובד");
      return;
    }
    if (dirty && !(await save())) return;
    setAssigning(true);
    setError(null);
    try {
      const r = await api<{ task: Task }>(`/api/tasks/${id}/assign`, { body: { assigneeId: assignee } });
      setTask(r.task);
      setNotice(`המשימה שויכה ל${employees.find((e) => e.id === assignee)?.name ?? "עובד"}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAssigning(false);
    }
  }

  const locked = task?.status === "completed";

  return (
    <>
      <AppHeader
        user={user}
        aiMode={aiMode}
        onLogout={logout}
        homeHref="/manager"
        extra={user && <ManagerNav onNew={load} />}
      />
      <main className="mx-auto w-full max-w-6xl px-4 py-6">
        <Link href="/manager" className="text-sm text-indigo-700 hover:underline">
          → חזרה לרשימת המשימות
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
        {task && form && (
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_24rem]">
            <div className="space-y-6">
              <Card>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <h1 className="text-lg font-semibold">
                    {task.status === "draft" ? "סקירה ועריכה לפני שיוך" : "פרטי המשימה"}
                  </h1>
                  <StatusBadge status={task.status} />
                  {task.aiSource === "demo" && (
                    <span className="text-xs text-amber-700">נוסח במצב הדגמה</span>
                  )}
                </div>

                {search.get("warn") && (
                  <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                    לא ניתן היה להתחבר למודל השפה — הניתוח בוצע במצב הדגמה. מומלץ לעבור על הפרטים.
                  </p>
                )}
                {task.status === "completed" && (
                  <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                    בוצע! · הושלמה {formatDate(task.completedAt)}
                  </p>
                )}

                {task.knowledgeSources.length > 0 && (
                  <div className="mb-4">
                    <SourcesList sources={task.knowledgeSources} label="ה-AI נעזר במסמכים מהמאגר" />
                  </div>
                )}
                <details className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-slate-700">הבקשה המקורית שלך</summary>
                  <p className="mt-2 whitespace-pre-wrap text-slate-600">{task.rawDescription}</p>
                </details>

                {task.clarificationQuestions.length > 0 && !locked && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                    <div className="font-medium text-amber-900">ה-AI זיהה מידע חסר:</div>
                    <ul className="mt-1 list-disc ps-5 text-amber-900">
                      {task.clarificationQuestions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <fieldset disabled={locked || saving} className="space-y-4">
                  <Field label="כותרת">
                    <input className={inputClass} maxLength={120} value={form.title} onChange={(e) => set("title", e.target.value)} />
                  </Field>
                  <Field label="מטרה">
                    <textarea rows={2} className={inputClass} value={form.objective} onChange={(e) => set("objective", e.target.value)} />
                  </Field>
                  <Field label="הנחיות מפורטות">
                    <textarea rows={4} className={inputClass} value={form.instructions} onChange={(e) => set("instructions", e.target.value)} />
                  </Field>
                  <Field label="שלבים מוצעים" hint="שלב אחד בכל שורה">
                    <textarea rows={5} className={inputClass} value={form.steps} onChange={(e) => set("steps", e.target.value)} />
                  </Field>
                  <Field label="תוצר מצופה">
                    <textarea rows={2} className={inputClass} value={form.deliverable} onChange={(e) => set("deliverable", e.target.value)} />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="מועד יעד" hint="השאירו ריק אם אין">
                      <input className={inputClass} maxLength={100} value={form.deadline} onChange={(e) => set("deadline", e.target.value)} placeholder="לא צוין" />
                    </Field>
                    <Field label="עדיפות">
                      <select className={inputClass} value={form.priority} onChange={(e) => set("priority", e.target.value as Form["priority"])}>
                        <option value="">לא צוינה</option>
                        <option value="low">נמוכה</option>
                        <option value="medium">בינונית</option>
                        <option value="high">גבוהה</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="פרויקט במאגר המידע" hint="משפיע על המסמכים שהצ'אט נעזר בהם">
                    <select className={inputClass} value={form.projectId} onChange={(e) => set("projectId", e.target.value)}>
                      <option value="">כל המאגר</option>
                      {form.projectId && !projects.some((p) => p.name === form.projectId) && (
                        <option value={form.projectId}>{form.projectId} (לא נמצא במאגר)</option>
                      )}
                      {projects.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="שאלות הבהרה פתוחות" hint="גלוי רק למנהל · שאלה בכל שורה">
                    <textarea rows={3} className={inputClass} value={form.clarificationQuestions} onChange={(e) => set("clarificationQuestions", e.target.value)} />
                  </Field>
                  <Field label="הערות פרטיות 🔒" hint="גלויות רק לך — לא יוצגו לעובד ולא יועברו לצ'אט של העובד">
                    <textarea rows={2} maxLength={4000} className={inputClass} value={form.managerNotes} onChange={(e) => set("managerNotes", e.target.value)} />
                  </Field>
                </fieldset>

                {error && (
                  <div className="mt-4">
                    <ErrorBox message={error} />
                  </div>
                )}
                {notice && <p className="mt-4 text-sm text-emerald-700">{notice}</p>}

                {!locked && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
                    <button onClick={save} className={secondaryBtn} disabled={saving || !dirty}>
                      {saving ? "שומר..." : "שמירת שינויים"}
                    </button>
                    <div className="ms-auto flex flex-wrap items-center gap-2">
                      <label htmlFor="assignee" className="text-sm text-slate-700">
                        שיוך לעובד:
                      </label>
                      <select id="assignee" className={`${inputClass} w-44`} value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={assigning}>
                        <option value="">בחירת עובד...</option>
                        {employees.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name} (דמו)
                          </option>
                        ))}
                      </select>
                      <button onClick={assign} className={primaryBtn} disabled={assigning || saving || !assignee}>
                        {assigning ? "משייך..." : task.status === "draft" ? "שיוך ושליחה" : "עדכון שיוך"}
                      </button>
                    </div>
                  </div>
                )}
              </Card>
            </div>
            <div className="lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
              <ChatPanel taskId={task.id} role="manager" />
            </div>
          </div>
        )}
      </main>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6"><Spinner /></div>}>
      <ManagerTaskPage />
    </Suspense>
  );
}
