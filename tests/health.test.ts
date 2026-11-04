import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";
import { createTask } from "@/lib/services";
import { getUser } from "@/lib/users";

const root = mkdtempSync(path.join(tmpdir(), "mesima8-health-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("GET /api/health", () => {
  it("reports ok with counts only, never task content", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.DATA_DIR = path.join(root, "data");
    await createTask(getUser("m1"), { description: "משימה סודית מאוד לבדיקה", project: null });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.storage).toMatchObject({ status: "ok", tasks: 1 });
    expect(body.checks.aiMode).toBe("demo");
    expect(JSON.stringify(body)).not.toContain("סודית");
  });
});
