export type Role = "manager" | "employee";

export interface User {
  id: string;
  name: string;
  role: Role;
  /** Demo identities are clearly labelled in the UI. */
  demo: true;
}

export type TaskStatus = "draft" | "assigned" | "completed";
export type Priority = "low" | "medium" | "high";
export type AiSource = "anthropic" | "demo";

export interface Task {
  id: string;
  managerId: string;
  assigneeId: string | null;
  /** The manager's original informal description. Manager-only. */
  rawDescription: string;
  title: string;
  objective: string;
  instructions: string;
  steps: string[];
  deliverable: string;
  /** Deadline exactly as provided by the manager, or null if none was given. */
  deadline: string | null;
  priority: Priority | null;
  /** Open questions for the manager about missing information. Manager-only. */
  clarificationQuestions: string[];
  /** Private notes. Never exposed to employees. */
  managerNotes: string;
  status: TaskStatus;
  aiSource: AiSource;
  createdAt: string;
  updatedAt: string;
  assignedAt: string | null;
  completedAt: string | null;
}

/** What an employee is allowed to see. */
export type EmployeeTaskView = Omit<
  Task,
  "rawDescription" | "managerNotes" | "clarificationQuestions"
>;

export type ChatChannel = Role;

export interface ChatMessage {
  id: string;
  taskId: string;
  /** Manager and employee conversations are kept separate. */
  channel: ChatChannel;
  sender: "user" | "assistant";
  authorId: string | null;
  content: string;
  source: AiSource | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  taskId: string;
  type: "task_completed";
  message: string;
  read: boolean;
  createdAt: string;
}

export interface Database {
  tasks: Task[];
  messages: ChatMessage[];
  notifications: Notification[];
}

/** Structured output of the AI task analysis. */
export interface TaskDraft {
  title: string;
  objective: string;
  instructions: string;
  steps: string[];
  deliverable: string;
  deadline: string | null;
  priority: Priority | null;
  clarificationQuestions: string[];
}

export const COMPLETION_MESSAGE = "בוצע!";
