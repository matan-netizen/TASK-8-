import { cookies } from "next/headers";
import { getUser } from "./users";
import type { User } from "./types";

/** MVP demo session: the selected demo identity is stored in an httpOnly cookie. */
export const SESSION_COOKIE = "demo_user";

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  return getUser(store.get(SESSION_COOKIE)?.value);
}
