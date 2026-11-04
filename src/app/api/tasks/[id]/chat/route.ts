import { handle, readJson } from "@/lib/http";
import { listMessages, sendMessage } from "@/lib/services";
import { currentUser } from "@/lib/session";

export async function GET(_req: Request, ctx: RouteContext<"/api/tasks/[id]/chat">) {
  const { id } = await ctx.params;
  return handle(async () => ({ messages: await listMessages(await currentUser(), id) }));
}

export async function POST(req: Request, ctx: RouteContext<"/api/tasks/[id]/chat">) {
  const { id } = await ctx.params;
  return handle(async () => sendMessage(await currentUser(), id, await readJson(req)), 201);
}
