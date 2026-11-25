import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getUser } from "./users";
import type { User } from "./types";

/**
 * Demo session stored in an httpOnly cookie.
 *
 * Security (OWASP A07/A04): the cookie is NOT the bare user id any more.
 * Its value is `userId.expiresAt.signature`, where the signature is an
 * HMAC-SHA256 over the id and expiry with a server-only secret. A cookie
 * that was edited, forged or expired is ignored.
 */
export const SESSION_COOKIE = "demo_user";
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

type SecretGlobal = { __sessionSecret?: string };
const g = globalThis as SecretGlobal;

function secret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (!g.__sessionSecret) {
    // Fail safe: without a configured secret, use a random one. Sessions
    // then reset on restart, but a forged cookie can never be accepted.
    g.__sessionSecret = randomBytes(32).toString("hex");
    if (process.env.NODE_ENV === "production") {
      console.warn("[security] SESSION_SECRET is missing or shorter than 32 characters; using a random per-process secret");
    }
  }
  return g.__sessionSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Build a signed cookie value for a user. */
export function createSessionToken(userId: string, now = Date.now()): string {
  const payload = `${userId}.${Math.floor(now / 1000) + SESSION_TTL_SECONDS}`;
  return `${payload}.${sign(payload)}`;
}

/** Return the user id from a valid, unexpired token, otherwise null. */
export function verifySessionToken(token: string | undefined | null, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  const expected = Buffer.from(sign(`${userId}.${exp}`));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 < now) return null;
  return userId;
}

export const sessionCookieOptions = () => ({
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
});

export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  return getUser(verifySessionToken(store.get(SESSION_COOKIE)?.value));
}

/** Optional shared access code that gates the demo login (ACCESS_CODE). */
export function accessCodeRequired(): boolean {
  return Boolean(process.env.ACCESS_CODE);
}

export function checkAccessCode(given: string | undefined): boolean {
  const code = process.env.ACCESS_CODE;
  if (!code) return true;
  const a = createHmac("sha256", "access").update(given ?? "").digest();
  const b = createHmac("sha256", "access").update(code).digest();
  return timingSafeEqual(a, b);
}
