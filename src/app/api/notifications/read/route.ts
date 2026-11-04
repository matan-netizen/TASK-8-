import { z } from "zod";
import { handle, readJson } from "@/lib/http";
import { markNotificationsRead, parse } from "@/lib/services";
import { currentUser } from "@/lib/session";

export async function POST(req: Request) {
  return handle(async () => {
    const { ids } = parse(z.object({ ids: z.array(z.string()).optional() }), await readJson(req));
    return { updated: await markNotificationsRead(await currentUser(), ids) };
  });
}
