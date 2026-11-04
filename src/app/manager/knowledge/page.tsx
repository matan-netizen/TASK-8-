"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, formatDate, useSession } from "@/lib/client";
import {
  AppHeader,
  Card,
  EmptyState,
  ErrorBox,
  Spinner,
  inputClass,
  primaryBtn,
} from "@/components/ui";
import { ManagerNav } from "@/components/ManagerNav";

interface Doc {
  id: string;
  title: string;
  project: string;
  ext: string;
  modifiedAt: string;
  chars: number;
  error?: string;
}
interface Overview {
  isSample: boolean;
  projects: { name: string; docs: number }[];
  docs: Doc[];
  skippedCount: number;
}
interface Hit {
  docId: string;
  title: string;
  project: string;
  excerpt: string;
  score: number;
}

export default function KnowledgePage() {
  const { user, aiMode, logout } = useSession("manager");
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [project, setProject] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Overview>("/api/knowledge"));
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

  async function search(e: FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) {
      setSearchError("יש להזין לפחות 2 תווים לחיפוש");
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ q });
      if (project) params.set("project", project);
      const r = await api<{ hits: Hit[] }>(`/api/knowledge/search?${params}`);
      setHits(r.hits);
    } catch (err) {
      setSearchError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  const docsByProject = useMemo(() => {
    const m = new Map<string, Doc[]>();
    for (const d of data?.docs ?? []) m.set(d.project, [...(m.get(d.project) ?? []), d]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "he"));
  }, [data]);

  return (
    <>
      <AppHeader user={user} aiMode={aiMode} onLogout={logout} homeHref="/manager" extra={user && <ManagerNav />} />
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        <Link href="/manager" className="text-sm text-indigo-700 hover:underline">
          → חזרה לרשימת המשימות
        </Link>

        <Card>
          <h1 className="text-lg font-semibold">📚 מאגר מידע</h1>
          <p className="mt-1 text-sm text-slate-600">
            מסמכי החברה שה-AI נעזר בהם כשהוא מנסח משימות ועונה בצ&apos;אט. כל תיקייה היא פרויקט.
            המסמכים נשמרים רק במחשב שמריץ את המערכת (בתיקייה <code dir="ltr">knowledge/</code>) ולא
            עולים לגיטהאב.
          </p>
          {data?.isSample && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              כרגע מוצג <strong>מאגר דוגמה בדיוני</strong>. כדי להשתמש במאגר האמיתי: הורידו את תיקיית הדרייב,
              חלצו אותה לתיקייה <code dir="ltr">knowledge/</code> בתיקיית הפרויקט, ורעננו את הדף.
            </p>
          )}
          {loadError && (
            <div className="mt-3">
              <ErrorBox message={loadError} onRetry={load} />
            </div>
          )}
          {!data && !loadError && (
            <div className="mt-3">
              <Spinner />
            </div>
          )}
          {data && (
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <span className="rounded-lg bg-slate-100 px-3 py-1.5">{data.projects.length} פרויקטים</span>
              <span className="rounded-lg bg-slate-100 px-3 py-1.5">{data.docs.length} מסמכים</span>
              {data.skippedCount > 0 && (
                <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-slate-500">
                  {data.skippedCount} קבצים לא נתמכים (וידאו, תמונות וכו&apos;) דולגו
                </span>
              )}
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-base font-semibold">חיפוש במאגר</h2>
          <p className="mb-3 text-xs text-slate-500">כך ה-AI מוצא את הקטעים הרלוונטיים למשימה או לשאלה.</p>
          <form onSubmit={search} className="flex flex-wrap gap-2">
            <label htmlFor="kb-q" className="sr-only">
              חיפוש
            </label>
            <input
              id="kb-q"
              className={`${inputClass} min-w-48 flex-1`}
              value={q}
              maxLength={300}
              onChange={(e) => setQ(e.target.value)}
              placeholder="לדוגמה: הודעות לקבוצה החיצונית"
            />
            <label htmlFor="kb-project" className="sr-only">
              פרויקט
            </label>
            <select
              id="kb-project"
              className={`${inputClass} w-auto`}
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">כל המאגר</option>
              {data?.projects.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="submit" className={primaryBtn} disabled={searching || !q.trim()}>
              {searching ? "מחפש..." : "חיפוש"}
            </button>
          </form>
          {searchError && (
            <div className="mt-3">
              <ErrorBox message={searchError} />
            </div>
          )}
          {hits && hits.length === 0 && (
            <div className="mt-3">
              <EmptyState>לא נמצאו קטעים מתאימים.</EmptyState>
            </div>
          )}
          {hits && hits.length > 0 && (
            <ul className="mt-4 space-y-3">
              {hits.map((h, i) => (
                <li key={`${h.docId}-${i}`} className="rounded-xl border border-slate-200 p-3">
                  <div className="text-sm font-semibold">{h.title}</div>
                  <div className="text-xs text-slate-500">{h.project}</div>
                  <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-sm text-slate-700">{h.excerpt}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {data && (
          <Card>
            <h2 className="mb-3 text-base font-semibold">מסמכים לפי פרויקט</h2>
            {docsByProject.length === 0 ? (
              <EmptyState>
                המאגר ריק. שימו קבצי <code dir="ltr">.docx</code>, <code dir="ltr">.xlsx</code>,{" "}
                <code dir="ltr">.csv</code>, <code dir="ltr">.md</code> או <code dir="ltr">.txt</code> בתיקייה{" "}
                <code dir="ltr">knowledge/</code>.
              </EmptyState>
            ) : (
              <div className="space-y-5">
                {docsByProject.map(([name, docs]) => (
                  <div key={name}>
                    <h3 className="mb-1 text-sm font-semibold text-slate-700">
                      {name} <span className="font-normal text-slate-400">({docs.length})</span>
                    </h3>
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                      {docs.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 flex-1 truncate">{d.title}</span>
                          <span className="text-xs text-slate-400" dir="ltr">
                            {d.ext}
                          </span>
                          {d.error ? (
                            <span className="text-xs text-red-700">{d.error}</span>
                          ) : (
                            <span className="text-xs text-slate-500">{d.chars.toLocaleString("he-IL")} תווים</span>
                          )}
                          <span className="text-xs text-slate-400">{formatDate(d.modifiedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </main>
    </>
  );
}
