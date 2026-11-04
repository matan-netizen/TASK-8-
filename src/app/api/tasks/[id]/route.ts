import { handle, readJson } from "@/lib/http";
import { getTask, updateTask } from "@/lib/services";
import { currentUser } from "@/lib/session";

export async function GET(_req: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  const { id } = await ctx.params;
  return handle(async () => ({ task: await getTask(await currentUser(), id) }));
}

export async function PATCH(req: Request, ctx: RouteContext<"/api/tasks/[id]">) {
  const { id } = await ctx.params;
  return handle(async () => ({ task: await updateTask(await currentUser(), id, await readJson(req)) }));
}
