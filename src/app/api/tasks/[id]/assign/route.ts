import { handle, readJson } from "@/lib/http";
import { assignTask } from "@/lib/services";
import { currentUser } from "@/lib/session";

export async function POST(req: Request, ctx: RouteContext<"/api/tasks/[id]/assign">) {
  const { id } = await ctx.params;
  return handle(async () => ({ task: await assignTask(await currentUser(), id, await readJson(req)) }));
}
