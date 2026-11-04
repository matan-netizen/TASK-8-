import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  assignTask,
  completeTask,
  createTask,
  getTask,
  listMessages,
  listNotifications,
  listTasks,
  markNotificationsRead,
  sendMessage,
  updateTask,
} from "@/lib/services";
import { getUser } from "@/lib/users";
import { COMPLETION_MESSAGE } from "@/lib/types";

const manager = getUser("m1");
const employee = getUser("e1");
const other = getUser("e2");
const root = mkdtempSync(path.join(tmpdir(), "mesima8-"));
let n = 0;

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY; // force deterministic demo mode
  process.env.DATA_DIR = path.join(root, `run-${n++}`);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function assignedTask(description = "תכין דוח מכירות רבעוני עד יום חמישי, דחוף") {
  const { task } = await createTask(manager, { description });
  await updateTask(manager, task.id, { managerNotes: "סוד: העובד בתקופת ניסיון" });
  await assignTask(manager, task.id, { assigneeId: "e1" });
  return task;
}

describe("task creation (demo AI)", () => {
  it("creates a structured draft and keeps provided deadline/priority verbatim", async () => {
    const { task } = await createTask(manager, {
      description: "תכין דוח מכירות רבעוני עד יום חמישי, דחוף",
    });
    expect(task.status).toBe("draft");
    expect(task.aiSource).toBe("demo");
    expect(task.title.length).toBeGreaterThan(0);
    expect(task.steps.length).toBeGreaterThan(0);
    expect(task.deadline).toBe("עד יום חמישי");
    expect(task.priority).toBe("high");
    expect(task.deliverable).toContain("דוח");
  });

  it("does not invent a deadline and asks a clarification question instead", async () => {
    const { task } = await createTask(manager, { description: "לסדר את המחסן" });
    expect(task.deadline).toBeNull();
    expect(task.priority).toBeNull();
    expect(task.clarificationQuestions.some((q) => q.includes("מועד"))).toBe(true);
  });

  it("validates input and enforces the manager role", async () => {
    await expect(createTask(manager, { description: " " })).rejects.toMatchObject({ status: 400 });
    await expect(createTask(employee, { description: "משימה כלשהי" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(createTask(null, { description: "משימה כלשהי" })).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe("assignment and visibility", () => {
  it("lets the manager edit before assigning; employee sees only assigned tasks", async () => {
    const { task } = await createTask(manager, { description: "להכין מצגת ללקוח חדש" });
    expect(await listTasks(employee)).toHaveLength(0); // drafts are hidden
    await expect(getTask(employee, task.id)).rejects.toMatchObject({ status: 404 });

    const edited = await updateTask(manager, task.id, { title: "מצגת ללקוח", deadline: "עד 10/11" });
    expect(edited.title).toBe("מצגת ללקוח");
    await assignTask(manager, task.id, { assigneeId: "e1" });

    const mine = await listTasks(employee);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: "מצגת ללקוח", deadline: "עד 10/11", status: "assigned" });
    expect(await listTasks(other)).toHaveLength(0);
  });

  it("never exposes manager-only fields to employees", async () => {
    const task = await assignedTask();
    const view = (await getTask(employee, task.id)) as Record<string, unknown>;
    expect(view.managerNotes).toBeUndefined();
    expect(view.rawDescription).toBeUndefined();
    expect(view.clarificationQuestions).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("תקופת ניסיון");
  });

  it("rejects assignment to a non-employee", async () => {
    const { task } = await createTask(manager, { description: "משימה לבדיקה כלשהי" });
    await expect(assignTask(manager, task.id, { assigneeId: "m1" })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("completion and notifications", () => {
  it(`notifies the manager with exactly "${COMPLETION_MESSAGE}" once`, async () => {
    const task = await assignedTask();
    const first = await completeTask(employee, task.id);
    expect(first.alreadyCompleted).toBe(false);
    expect(first.task.status).toBe("completed");

    const again = await completeTask(employee, task.id);
    expect(again.alreadyCompleted).toBe(true);

    const notes = await listNotifications(manager);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ message: "בוצע!", taskId: task.id, read: false });

    expect(await markNotificationsRead(manager)).toBe(1);
    expect((await listNotifications(manager))[0].read).toBe(true);
  });

  it("creates a single notification under concurrent completion requests", async () => {
    const task = await assignedTask();
    await Promise.all([1, 2, 3, 4, 5].map(() => completeTask(employee, task.id)));
    expect(await listNotifications(manager)).toHaveLength(1);
  });

  it("only the assigned employee can complete, and completed tasks are locked", async () => {
    const task = await assignedTask();
    await expect(completeTask(other, task.id)).rejects.toMatchObject({ status: 404 });
    await expect(completeTask(manager, task.id)).rejects.toMatchObject({ status: 403 });
    await completeTask(employee, task.id);
    await expect(updateTask(manager, task.id, { title: "x" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("chat", () => {
  it("keeps manager and employee conversations separate per task", async () => {
    const task = await assignedTask();
    const m = await sendMessage(manager, task.id, { message: "מה חסר במשימה?" });
    expect(m.userMessage.sender).toBe("user");
    expect(m.reply.sender).toBe("assistant");
    expect(m.reply.source).toBe("demo");

    const e = await sendMessage(employee, task.id, { message: "עד מתי צריך לסיים?" });
    expect(e.reply.content).toContain("עד יום חמישי");
    expect(e.reply.content).not.toContain("תקופת ניסיון");

    const managerMsgs = await listMessages(manager, task.id);
    const employeeMsgs = await listMessages(employee, task.id);
    expect(managerMsgs).toHaveLength(2);
    expect(employeeMsgs).toHaveLength(2);
    expect(employeeMsgs.every((x) => x.channel === "employee")).toBe(true);
  });

  it("tells the employee to ask the manager when information is missing", async () => {
    const { task } = await createTask(manager, { description: "לסדר את המחסן" });
    await assignTask(manager, task.id, { assigneeId: "e1" });
    const r = await sendMessage(employee, task.id, { message: "מתי הדדליין?" });
    expect(r.reply.content).toContain("לא צוין");
    expect(r.reply.content).toContain("למנהל");
  });

  it("validates chat messages", async () => {
    const task = await assignedTask();
    await expect(sendMessage(employee, task.id, { message: "" })).rejects.toMatchObject({ status: 400 });
    await expect(sendMessage(other, task.id, { message: "היי" })).rejects.toMatchObject({ status: 404 });
  });
});
