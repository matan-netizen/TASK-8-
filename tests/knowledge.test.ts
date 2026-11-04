import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  detectProject,
  getKnowledgeIndex,
  listProjects,
  searchKnowledge,
  tokenize,
} from "@/lib/knowledge";
import {
  assignTask,
  createTask,
  getKnowledgeOverview,
  getTask,
  searchKnowledgeBase,
  sendMessage,
} from "@/lib/services";
import { getUser } from "@/lib/users";

const manager = getUser("m1");
const employee = getUser("e1");
const root = mkdtempSync(path.join(tmpdir(), "mesima8-kb-"));
const kb = path.join(root, "knowledge");
let n = 0;

beforeAll(async () => {
  mkdirSync(path.join(kb, "פרויקט שקד"), { recursive: true });
  mkdirSync(path.join(kb, "פרויקט ברוש"), { recursive: true });
  writeFileSync(
    path.join(kb, "פרויקט שקד", "בריף.md"),
    "# בריף שקד\nקהל היעד: משפחות צעירות.\n\nהמסר המרכזי: גינה פרטית לכל דירה וקרבה לבתי ספר.",
  );
  writeFileSync(
    path.join(kb, "פרויקט ברוש", "בריף.md"),
    "# בריף ברוש\nקהל היעד: משקיעים.\n\nהמסר המרכזי: תשואה משכירות ומיקום ליד תחנת רכבת.",
  );
  writeFileSync(path.join(kb, "נוהל.txt"), "כל הודעת SMS מוגבלת ל-200 תווים כולל קישור.");
  writeFileSync(path.join(kb, "פרויקט שקד", "טיזר.mp4"), "not a video");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("תוכנית");
  ws.addRow(["מטרה", "קהל", "תוכן"]);
  ws.addRow(["חשיפה", "קבוצה חיצונית", "הודעה על השקת שלב ב' בפרויקט שקד"]);
  writeFileSync(path.join(kb, "פרויקט שקד", "תוכנית עבודה.xlsx"), Buffer.from(await wb.xlsx.writeBuffer()));
});

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.KNOWLEDGE_DIR = kb;
  process.env.DATA_DIR = path.join(root, `data-${n++}`);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("knowledge index", () => {
  it("strips common Hebrew prefixes when tokenizing", () => {
    const t = tokenize("ולקבוצה החיצונית");
    expect(t).toContain("קבוצה");
    expect(t).toContain("חיצונית");
  });

  it("indexes folders as projects, reads xlsx, and skips unsupported files", async () => {
    const index = await getKnowledgeIndex();
    expect(index.isSample).toBe(false);
    expect(listProjects(index).map((p) => p.name).sort()).toEqual(["כללי", "פרויקט ברוש", "פרויקט שקד"].sort());
    expect(index.skipped.some((s) => s.endsWith("טיזר.mp4"))).toBe(true);
    const xlsx = index.docs.find((d) => d.ext === ".xlsx");
    expect(xlsx?.chars).toBeGreaterThan(0);
    expect(xlsx?.error).toBeUndefined();
  });

  it("finds relevant passages and respects the project filter", async () => {
    const index = await getKnowledgeIndex();
    const hits = searchKnowledge(index, "מה קהל היעד של המשקיעים?");
    expect(hits[0].project).toBe("פרויקט ברוש");

    const scoped = searchKnowledge(index, "קהל היעד", { project: "פרויקט שקד" });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((h) => h.project === "פרויקט שקד" || h.project === "כללי")).toBe(true);
  });

  it("detects the project named in a task description", async () => {
    const index = await getKnowledgeIndex();
    expect(detectProject(index, "תכין 3 הודעות לקבוצה של שקד")).toBe("פרויקט שקד");
    expect(detectProject(index, "תכין הודעות")).toBeNull();
  });

  it("falls back to the committed fictional sample when no knowledge folder exists", async () => {
    process.env.KNOWLEDGE_DIR = path.join(root, "missing");
    const index = await getKnowledgeIndex();
    expect(index.isSample).toBe(true);
    expect(index.docs.length).toBeGreaterThan(0);
  });
});

describe("knowledge in the task workflow", () => {
  it("uses the detected project's documents when drafting a task", async () => {
    const { task } = await createTask(manager, { description: "תכין הודעה לקבוצה החיצונית על פרויקט שקד" });
    expect(task.projectId).toBe("פרויקט שקד");
    expect(task.knowledgeSources.length).toBeGreaterThan(0);
    expect(task.knowledgeSources.every((s) => s.project === "פרויקט שקד" || s.project === "כללי")).toBe(true);
    expect(task.instructions).toContain("מאגר המידע");
  });

  it("rejects an unknown project and allows the whole base (null)", async () => {
    await expect(
      createTask(manager, { description: "משימה כלשהי לבדיקה", project: "לא קיים" }),
    ).rejects.toMatchObject({ status: 400 });
    const { task } = await createTask(manager, { description: "הודעות SMS ללידים", project: null });
    expect(task.projectId).toBeNull();
  });

  it("gives the employee chat relevant sources and shows source titles on the task", async () => {
    const { task } = await createTask(manager, { description: "תכין הודעה על פרויקט שקד" });
    await assignTask(manager, task.id, { assigneeId: "e1" });
    const view = await getTask(employee, task.id);
    expect(Array.isArray(view.knowledgeSources)).toBe(true);

    const r = await sendMessage(employee, task.id, { message: "מי קהל היעד?" });
    expect(r.reply.sources?.length).toBeGreaterThan(0);
    expect(r.reply.content).toContain("משפחות צעירות");
  });

  it("does not cite documents when the task itself answers the question", async () => {
    const { task } = await createTask(manager, { description: "תכין הודעה על פרויקט שקד עד יום חמישי" });
    await assignTask(manager, task.id, { assigneeId: "e1" });
    const r = await sendMessage(employee, task.id, { message: "עד מתי צריך לסיים?" });
    expect(r.reply.content).toContain("חמישי");
    expect(r.reply.sources).toEqual([]);
    expect(r.reply.content).not.toContain("מאגר המידע");
  });

  it("restricts knowledge browsing and search to managers", async () => {
    await expect(getKnowledgeOverview(employee)).rejects.toMatchObject({ status: 403 });
    await expect(searchKnowledgeBase(employee, { q: "קהל" })).rejects.toMatchObject({ status: 403 });
    const hits = await searchKnowledgeBase(manager, { q: "רכבת" });
    expect(hits[0].project).toBe("פרויקט ברוש");
    await expect(searchKnowledgeBase(manager, { q: "א" })).rejects.toMatchObject({ status: 400 });
  });
});
