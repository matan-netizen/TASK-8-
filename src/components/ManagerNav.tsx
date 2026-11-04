"use client";

import Link from "next/link";
import { NotificationsBell } from "./NotificationsBell";

/** Header actions for manager pages: knowledge base link + notifications. */
export function ManagerNav({ onNew }: { onNew?: () => void }) {
  return (
    <>
      <Link
        href="/manager/knowledge"
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
      >
        📚 מאגר מידע
      </Link>
      <NotificationsBell onNew={onNew} />
    </>
  );
}
