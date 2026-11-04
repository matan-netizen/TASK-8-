import { handle } from "@/lib/http";
import { completeTask } from "@/lib/services";
import { currentUser } from "@/lib/session";

export async function POST(_req: Request, ctx: RouteContext<"/api/tasks/[id]/complete">) {
  const { id } = await ctx.params;
  return handle(async () => completeTask(await currentUser(), id));
}
