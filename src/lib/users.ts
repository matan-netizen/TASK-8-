import type { User } from "./types";

/** Demo identities for testing the MVP without real authentication. */
export const DEMO_USERS: User[] = [
  { id: "m1", name: "יוסי לוי", role: "manager", demo: true },
  { id: "e1", name: "אבי כהן", role: "employee", demo: true },
  { id: "e2", name: "משה ישראלי", role: "employee", demo: true },
];

export function getUser(id: string | undefined | null): User | null {
  if (!id) return null;
  return DEMO_USERS.find((u) => u.id === id) ?? null;
}

export function getEmployees(): User[] {
  return DEMO_USERS.filter((u) => u.role === "employee");
}
