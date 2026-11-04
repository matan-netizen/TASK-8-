import { randomUUID } from "crypto";
import { z } from "zod";
import { mutate, read } from "./store";
import { analyzeTask, chatReply, type ChatContextTask } from "./ai";
import { getUser } from "./users";
import {
  COMPLETION_MESSAGE,
  type ChatChannel,
  type ChatMessage,
  type EmployeeTaskView,
  type Notification,
  type Task,
  type User,
} from "./types";

/** Error with an HTTP status and a Hebrew, user-facing message. */
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const now = () => new Date().toISOString();

function requireRole(user: User | null, role: User["role"]): User {
  if (!user) throw new AppError(401, "יש להתחבר כדי להמשיך");
  if (user.role !== role) throw new AppError(403, "אין הרשאה לפעולה זו");
  return user;
}

export function toEmployeeView(task: Task): EmployeeTaskView {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rawDescription, managerNotes, clarificationQuestions, ...rest } = task;
  return rest;
}

// ---------- validation ----------

export const createTaskSchema = z.object({
  description: z
    .string({ error: "יש להזין תיאור משימה" })
    .trim()
    .min(3, "תיאור המשימה קצר מדי")
    .max(4000, "תיאור המשימה ארוך מדי (עד 4000 תווים)"),
});

const shortText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} הוא שדה חובה`).max(max, `${label} ארוך מדי`);

export const updateTaskSchema = z
  .object({
    title: shortText("כותרת", 120),
    objective: shortText("מטרה", 2000),
    instructions: shortText("הנחיות", 8000),
    steps: z.array(z.string().trim().min(1).max(500)).max(20, "יותר מדי שלבים"),
    deliverable: shortText("תוצר", 2000),
    deadline: z.string().trim().max(100).nullable(),
    priority: z.enum(["low", "medium", "high"]).nullable(),
    clarificationQuestions: z.array(z.string().trim().min(1).max(500)).max(20),
    managerNotes: z.string().max(4000, "ההערות ארוכות מדי"),
  })
  .partial();

export const assignSchema = z.object({
  assigneeId: z.string({ error: "יש לבחור עובד" }).min(1, "יש לבחור עובד"),
});

export const chatSchema = z.object({
  message: z
    .string({ error: "יש להזין הודעה" })
    .trim()
    .min(1, "יש להזין הודעה")
    .max(2000, "ההודעה ארוכה מדי (עד 2000 תווים)"),
});

export function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new AppError(400, r.error.issues[0]?.message ?? "קלט לא תקין");
  return r.data;
}

// ---------- tasks ----------

export async function createTask(
  user: User | null,
  input: unknown,
): Promise<{ task: Task; warning?: string }> {
  const manager = requireRole(user, "manager");
  const { description } = parse(createTaskSchema, input);
  const analysis = await analyzeTask(description);
  const t = now();
  const task: Task = {
    id: randomUUID(),
    managerId: manager.id,
    assigneeId: null,
    rawDescription: description,
    ...analysis.value,
    managerNotes: "",
    status: "draft",
    aiSource: analysis.source,
    createdAt: t,
    updatedAt: t,
    assignedAt: null,
    completedAt: null,
  };
  await mutate((db) => {
    db.tasks.push(task);
  });
  return { task, warning: analysis.warning };
}

export async function listTasks(user: User | null): Promise<Task[] | EmployeeTaskView[]> {
  if (!user) throw new AppError(401, "יש להתחבר כדי להמשיך");
  return read((db) => {
    const sorted = [...db.tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (user.role === "manager") return sorted.filter((t) => t.managerId === user.id);
    return sorted
      .filter((t) => t.assigneeId === user.id && t.status !== "draft")
      .map(toEmployeeView);
  });
}

function findForUser(tasks: Task[], user: User, id: string): Task {
  const task = tasks.find((t) => t.id === id);
  const allowed =
    task &&
    (user.role === "manager"
      ? task.managerId === user.id
      : task.assigneeId === user.id && task.status !== "draft");
  if (!task || !allowed) throw new AppError(404, "המשימה לא נמצאה");
  return task;
}

export async function getTask(user: User | null, id: string): Promise<Task | EmployeeTaskView> {
  if (!user) throw new AppError(401, "יש להתחבר כדי להמשיך");
  return read((db) => {
    const task = findForUser(db.tasks, user, id);
    return user.role === "manager" ? task : toEmployeeView(task);
  });
}

export async function updateTask(user: User | null, id: string, input: unknown): Promise<Task> {
  const manager = requireRole(user, "manager");
  const patch = parse(updateTaskSchema, input);
  return mutate((db) => {
    const task = findForUser(db.tasks, manager, id);
    if (task.status === "completed") throw new AppError(409, "לא ניתן לערוך משימה שהושלמה");
    Object.assign(task, patch, { updatedAt: now() });
    return task;
  });
}

export async function assignTask(user: User | null, id: string, input: unknown): Promise<Task> {
  const manager = requireRole(user, "manager");
  const { assigneeId } = parse(assignSchema, input);
  const employee = getUser(assigneeId);
  if (!employee || employee.role !== "employee") throw new AppError(400, "העובד שנבחר אינו קיים");
  return mutate((db) => {
    const task = findForUser(db.tasks, manager, id);
    if (task.status === "completed") throw new AppError(409, "המשימה כבר הושלמה");
    const t = now();
    task.assigneeId = employee.id;
    task.status = "assigned";
    task.assignedAt = t;
    task.updatedAt = t;
    return task;
  });
}

/**
 * Mark a task complete. Idempotent: the status change and the single
 * "בוצע!" notification happen in one atomic mutation, and a repeated call
 * returns the existing state without creating another notification.
 */
export async function completeTask(
  user: User | null,
  id: string,
): Promise<{ task: EmployeeTaskView; alreadyCompleted: boolean }> {
  const employee = requireRole(user, "employee");
  return mutate((db) => {
    const task = findForUser(db.tasks, employee, id);
    if (task.status === "completed") return { task: toEmployeeView(task), alreadyCompleted: true };
    const t = now();
    task.status = "completed";
    task.completedAt = t;
    task.updatedAt = t;
    const exists = db.notifications.some(
      (n) => n.taskId === task.id && n.type === "task_completed",
    );
    if (!exists) {
      db.notifications.push({
        id: randomUUID(),
        userId: task.managerId,
        taskId: task.id,
        type: "task_completed",
        message: COMPLETION_MESSAGE,
        read: false,
        createdAt: t,
      });
    }
    return { task: toEmployeeView(task), alreadyCompleted: false };
  });
}

// ---------- chat ----------

export async function listMessages(user: User | null, taskId: string): Promise<ChatMessage[]> {
  if (!user) throw new AppError(401, "יש להתחבר כדי להמשיך");
  const channel: ChatChannel = user.role;
  return read((db) => {
    findForUser(db.tasks, user, taskId);
    return db.messages
      .filter((m) => m.taskId === taskId && m.channel === channel)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });
}

export async function sendMessage(
  user: User | null,
  taskId: string,
  input: unknown,
): Promise<{ userMessage: ChatMessage; reply: ChatMessage; warning?: string }> {
  if (!user) throw new AppError(401, "יש להתחבר כדי להמשיך");
  const { message } = parse(chatSchema, input);
  const channel: ChatChannel = user.role;

  const { task, history } = await read((db) => ({
    task: findForUser(db.tasks, user, taskId),
    history: db.messages
      .filter((m) => m.taskId === taskId && m.channel === channel)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));

  const context: ChatContextTask =
    channel === "manager" ? task : (toEmployeeView(task) as ChatContextTask);

  const userMessage: ChatMessage = {
    id: randomUUID(),
    taskId,
    channel,
    sender: "user",
    authorId: user.id,
    content: message,
    source: null,
    createdAt: now(),
  };
  await mutate((db) => {
    db.messages.push(userMessage);
  });

  const ai = await chatReply(channel, context, history, message);
  const reply: ChatMessage = {
    id: randomUUID(),
    taskId,
    channel,
    sender: "assistant",
    authorId: null,
    content: ai.value,
    source: ai.source,
    createdAt: now(),
  };
  await mutate((db) => {
    db.messages.push(reply);
  });
  return { userMessage, reply, warning: ai.warning };
}

// ---------- notifications ----------

export async function listNotifications(user: User | null): Promise<Notification[]> {
  const manager = requireRole(user, "manager");
  return read((db) =>
    db.notifications
      .filter((n) => n.userId === manager.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );
}

export async function markNotificationsRead(user: User | null, ids?: string[]): Promise<number> {
  const manager = requireRole(user, "manager");
  return mutate((db) => {
    let count = 0;
    for (const n of db.notifications) {
      if (n.userId === manager.id && !n.read && (!ids || ids.includes(n.id))) {
        n.read = true;
        count++;
      }
    }
    return count;
  });
}
