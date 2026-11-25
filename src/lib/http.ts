import { NextResponse } from "next/server";
import { AppError } from "./services";

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError(400, "גוף הבקשה אינו JSON תקין");
  }
}

export async function handle<T>(fn: () => Promise<T>, status = 200): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn(), { status });
  } catch (err) {
    if (err instanceof AppError) {
      // Security logging (OWASP A09): denied and throttled requests are
      // recorded without request bodies or task content.
      if ([401, 403, 429].includes(err.status)) {
        console.warn("[security] request denied", { status: err.status, reason: err.message });
      }
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[api] unexpected error:", err);
    return NextResponse.json({ error: "אירעה שגיאה בשרת. נסו שוב." }, { status: 500 });
  }
}
