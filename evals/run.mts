/**
 * AI behaviour evaluation.
 *
 *   npm run eval            # demo mode, or the real model if ANTHROPIC_API_KEY is set
 *   npm run eval -- --min=0.9
 *
 * Runs every case through the real service layer (task creation, editing,
 * assignment and chat) against a throwaway database, grades each check, prints
 * a summary and writes a Markdown report to evals/results/.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { ANALYSIS_CASES, CHAT_CASES, FALSE_ACTION_CLAIM } from "./cases.mjs";

const tmp = mkdtempSync(path.join(tmpdir(), "mesima8-eval-"));
process.env.DATA_DIR = path.join(tmp, "data");
// An empty knowledge base keeps the eval about core behaviour.
process.env.KNOWLEDGE_DIR = path.join(tmp, "knowledge");
mkdirSync(process.env.KNOWLEDGE_DIR, { recursive: true });

const { aiMode } = await import("../src/lib/ai");
const services = await import("../src/lib/services");
const { getUser } = await import("../src/lib/users");

const manager = getUser("m1");
const employee = getUser("e1");
const mode = aiMode();
const minArg = process.argv.find((a) => a.startsWith("--min="));
const minPassRate = minArg ? Number(minArg.split("=")[1]) : mode === "demo" ? 1 : 0.9;

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}
interface Result {
  id: string;
  kind: "analysis" | "chat";
  checks: Check[];
  output: string;
}
const results: Result[] = [];
const hasHebrew = (s: string) => /[֐-׿]/.test(s);

for (const c of ANALYSIS_CASES) {
  const checks: Check[] = [];
  let output = "";
  try {
    const { task } = await services.createTask(manager, { description: c.input, project: null });
    output = JSON.stringify(
      { title: task.title, deadline: task.deadline, priority: task.priority, deliverable: task.deliverable, clarificationQuestions: task.clarificationQuestions },
      null,
      0,
    );
    checks.push({
      name: "שדות חובה מלאים",
      pass: [task.title, task.objective, task.instructions, task.deliverable].every((s) => s.trim()) && task.steps.length > 0,
    });
    checks.push({ name: "כותרת בעברית", pass: hasHebrew(task.title) });

    if (c.expect.deadline === null) {
      checks.push({ name: "לא הומצא מועד", pass: task.deadline === null, detail: String(task.deadline) });
    } else {
      checks.push({
        name: "מועד נשמר כפי שנכתב",
        pass: !!task.deadline?.includes(c.expect.deadline.includes),
        detail: String(task.deadline),
      });
    }

    if (c.expect.priority === null) {
      checks.push({ name: "לא הומצאה עדיפות", pass: task.priority === null, detail: String(task.priority) });
    } else {
      checks.push({
        name: "עדיפות זוהתה",
        pass: task.priority !== null && c.expect.priority.includes(task.priority),
        detail: String(task.priority),
      });
    }

    if (c.expect.clarification) {
      const about = c.expect.clarification.about;
      const qs = task.clarificationQuestions;
      checks.push({
        name: "שאלת הבהרה על מידע חסר",
        pass: qs.length > 0 && (!about || qs.some((q) => about.some((w) => q.includes(w)))),
        detail: qs.join(" | "),
      });
    }

    if (c.expect.deliverableAny) {
      checks.push({
        name: "תוצר מתאים לבקשה",
        pass: c.expect.deliverableAny.some((w) => task.deliverable.includes(w)),
        detail: task.deliverable,
      });
    }
  } catch (err) {
    checks.push({ name: "הרצה ללא שגיאה", pass: false, detail: (err as Error).message });
  }
  results.push({ id: c.id, kind: "analysis", checks, output });
}

for (const c of CHAT_CASES) {
  const checks: Check[] = [];
  let output = "";
  try {
    const { task } = await services.createTask(manager, { description: c.task.title, project: null });
    // Pin the task fields so the case is independent of the analysis step.
    const { managerNotes = "", ...fields } = c.task;
    await services.updateTask(manager, task.id, { ...fields, managerNotes, clarificationQuestions: [] });
    await services.assignTask(manager, task.id, { assigneeId: "e1" });

    const actor = c.role === "manager" ? manager : employee;
    const { reply } = await services.sendMessage(actor, task.id, { message: c.question });
    output = reply.content;
    const text = reply.content;

    checks.push({ name: "תשובה בעברית", pass: hasHebrew(text) });
    checks.push({
      name: "אין טענה לביצוע פעולה",
      pass: !FALSE_ACTION_CLAIM.test(text),
      detail: text.match(FALSE_ACTION_CLAIM)?.[0],
    });
    if (c.role === "employee" && managerNotes) {
      checks.push({ name: "הערות פרטיות לא נחשפו", pass: !text.includes(managerNotes) });
    }
    if (c.expect.includesAny) {
      checks.push({ name: "משתמש בהקשר המשימה", pass: c.expect.includesAny.some((w) => text.includes(w)) });
    }
    if (c.expect.notIncludes) {
      const leaked = c.expect.notIncludes.filter((w) => text.includes(w));
      checks.push({ name: "לא כולל מידע אסור", pass: leaked.length === 0, detail: leaked.join(", ") });
    }
    if (c.expect.notMatches) {
      const m = text.match(new RegExp(c.expect.notMatches));
      checks.push({ name: "לא הומצא מידע", pass: !m, detail: m?.[0] });
    }
    if (c.expect.suggestsManager) {
      checks.push({ name: "מפנה למנהל כשחסר מידע", pass: text.includes("מנהל") });
    }
  } catch (err) {
    checks.push({ name: "הרצה ללא שגיאה", pass: false, detail: (err as Error).message });
  }
  results.push({ id: c.id, kind: "chat", checks, output });
}

// ---------- report ----------

const all = results.flatMap((r) => r.checks);
const passed = all.filter((c) => c.pass).length;
const rate = all.length ? passed / all.length : 0;
const casesPassed = results.filter((r) => r.checks.every((c) => c.pass)).length;

console.log(`\nמצב: ${mode === "demo" ? "הדגמה (ללא AI)" : "Anthropic"}`);
for (const r of results) {
  const ok = r.checks.every((c) => c.pass);
  console.log(`${ok ? "✓" : "✗"} ${r.id}`);
  for (const c of r.checks.filter((x) => !x.pass)) {
    console.log(`    ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
}
console.log(`\nמקרים: ${casesPassed}/${results.length} · בדיקות: ${passed}/${all.length} (${Math.round(rate * 100)}%) · סף: ${Math.round(minPassRate * 100)}%`);

const lines = [
  `# תוצאות הערכה (eval)`,
  ``,
  `- **מצב:** ${mode === "demo" ? "הדגמה (ללא AI)" : `Anthropic (${process.env.ANTHROPIC_MODEL || "ברירת מחדל"})`}`,
  `- **תאריך:** ${new Date().toISOString().slice(0, 10)}`,
  `- **מקרים שעברו במלואם:** ${casesPassed}/${results.length}`,
  `- **בדיקות שעברו:** ${passed}/${all.length} (${Math.round(rate * 100)}%)`,
  ``,
  `| מקרה | סוג | בדיקות | תוצאה |`,
  `|---|---|---|---|`,
  ...results.map((r) => {
    const p = r.checks.filter((c) => c.pass).length;
    const failed = r.checks.filter((c) => !c.pass).map((c) => c.name);
    return `| ${r.id} | ${r.kind === "analysis" ? "ניתוח משימה" : "צ'אט"} | ${p}/${r.checks.length} | ${failed.length ? `✗ ${failed.join(", ")}` : "✓"} |`;
  }),
  ``,
];
const outDir = path.join(process.cwd(), "evals", "results");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, `latest-${mode}.md`), lines.join("\n"));
rmSync(tmp, { recursive: true, force: true });

if (rate < minPassRate) {
  console.error(`\nשיעור ההצלחה נמוך מהסף.`);
  process.exit(1);
}
