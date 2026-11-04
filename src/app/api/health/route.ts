import { NextResponse } from "next/server";
import { aiMode } from "@/lib/ai";
import { getKnowledgeIndex } from "@/lib/knowledge";
import { read } from "@/lib/store";

/**
 * Health check for monitoring and the hosting platform. Public on purpose,
 * so it returns only counts and statuses, never task or document content.
 */
export async function GET() {
  const checks: Record<string, unknown> = { aiMode: aiMode() };
  let ok = true;

  try {
    checks.storage = await read((db) => ({ status: "ok", tasks: db.tasks.length }));
  } catch (err) {
    ok = false;
    checks.storage = { status: "error" };
    console.error("[health] storage check failed:", err);
  }

  try {
    const kb = await getKnowledgeIndex();
    checks.knowledge = { status: "ok", docs: kb.docs.length, isSample: kb.isSample };
  } catch (err) {
    checks.knowledge = { status: "error" };
    console.error("[health] knowledge check failed:", err);
  }

  return NextResponse.json(
    {
      status: ok ? "ok" : "error",
      version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      time: new Date().toISOString(),
      checks,
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
