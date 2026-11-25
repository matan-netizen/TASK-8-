import { cookies, headers } from "next/headers";
import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { LIMITS, takeToken } from "@/lib/rate-limit";
import { AppError, parse } from "@/lib/services";
import {
  accessCodeRequired,
  checkAccessCode,
  createSessionToken,
  currentUser,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";
import { getUser } from "@/lib/users";

export async function GET() {
  return handle(async () => ({ user: await currentUser(), accessCodeRequired: accessCodeRequired() }));
}

const loginSchema = z.object({
  userId: z.string().max(50),
  accessCode: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  return handle(async () => {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (!takeToken(`login:${ip}`, LIMITS.login())) {
      console.warn("[security] login rate limit exceeded", { ip });
      throw new AppError(429, "יותר מדי ניסיונות התחברות. נסו שוב בעוד דקה.");
    }
    const { userId, accessCode } = parse(loginSchema, await readJson(req));
    if (!checkAccessCode(accessCode)) {
      console.warn("[security] login failed: wrong access code", { ip });
      throw new AppError(401, "קוד הגישה שגוי");
    }
    const user = getUser(userId);
    if (!user) throw new AppError(400, "משתמש לא קיים");
    const store = await cookies();
    store.set(SESSION_COOKIE, createSessionToken(user.id), sessionCookieOptions());
    console.info("[security] login", { userId: user.id, ip });
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
