import { NextResponse, type NextRequest } from "next/server";

/**
 * CSRF protection (OWASP A01): state-changing API requests must come from
 * this site. Browsers always send Origin on cross-site POST/PATCH/DELETE,
 * so a request whose Origin differs from our own host is rejected.
 * Requests without Origin (curl, server-to-server) carry no victim cookie
 * from a browser and are left to the normal session checks.
 */
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(req: NextRequest) {
  if (SAFE.has(req.method)) return NextResponse.next();
  const origin = req.headers.get("origin");
  if (!origin) return NextResponse.next();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (!host || originHost !== host) {
    console.warn("[security] blocked cross-site request", { method: req.method, path: req.nextUrl.pathname, origin });
    return NextResponse.json({ error: "בקשה ממקור לא מורשה" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
