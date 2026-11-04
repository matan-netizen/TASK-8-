"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiSource, User } from "@/lib/types";
import { api } from "@/lib/client";
import { AiModeBadge, Card, ErrorBox, Spinner } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[] | null>(null);
  const [aiMode, setAiMode] = useState<AiSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<{ users: User[] }>("/api/users"), api<{ aiMode: AiSource }>("/api/status")])
      .then(([u, s]) => {
        setUsers(u.users);
        setAiMode(s.aiMode);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function login(user: User) {
    setBusy(user.id);
    setError(null);
    try {
      await api("/api/session", { body: { userId: user.id } });
      router.push(user.role === "manager" ? "/manager" : "/employee");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-12">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-indigo-700">משימה 8</h1>
        <p className="mt-2 text-slate-600">ניהול משימות עם צ&apos;אט חכם למנהלים ולעובדים</p>
        <div className="mt-3 flex justify-center">
          <AiModeBadge mode={aiMode} />
        </div>
      </div>

      <Card>
        <h2 className="text-lg font-semibold">בחירת משתמש</h2>
        <p className="mb-4 text-sm text-slate-500">
          זוהי גרסת MVP ללא אימות אמיתי. כל המשתמשים הם <strong>משתמשי דמו</strong> לצורך בדיקה.
        </p>
        {error && <ErrorBox message={error} />}
        {!users && !error && <Spinner />}
        <div className="grid gap-3 sm:grid-cols-3">
          {users?.map((u) => (
            <button
              key={u.id}
              onClick={() => login(u)}
              disabled={busy !== null}
              className="rounded-xl border border-slate-200 p-4 text-start transition hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-60"
            >
              <div className="text-2xl">{u.role === "manager" ? "👔" : "🧑‍💻"}</div>
              <div className="mt-2 font-semibold">{u.name}</div>
              <div className="text-sm text-slate-600">{u.role === "manager" ? "מנהל" : "עובד"}</div>
              <div className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
                משתמש דמו
              </div>
              {busy === u.id && <div className="mt-2 text-xs text-indigo-700">מתחבר...</div>}
            </button>
          ))}
        </div>
      </Card>
    </main>
  );
}
