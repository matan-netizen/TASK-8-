import { cookies } from "next/headers";
import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { AppError, parse } from "@/lib/services";
import { currentUser, SESSION_COOKIE } from "@/lib/session";
import { getUser } from "@/lib/users";

export async function GET() {
  return handle(async () => ({ user: await currentUser() }));
}

export async function POST(req: Request) {
  return handle(async () => {
    const { userId } = parse(z.object({ userId: z.string() }), await readJson(req));
    const user = getUser(userId);
    if (!user) throw new AppError(400, "משתמש לא קיים");
    const store = await cookies();
    store.set(SESSION_COOKIE, user.id, { httpOnly: true, sameSite: "lax", path: "/" });
    return { user };
  });
}

export async function DELETE() {
  return handle(async () => {
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    return { ok: true };
  });
}
