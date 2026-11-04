import { handle } from "@/lib/http";
import { searchKnowledgeBase } from "@/lib/services";
import { currentUser } from "@/lib/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  return handle(async () => ({
    hits: await searchKnowledgeBase(await currentUser(), {
      q: url.searchParams.get("q") ?? "",
      project: url.searchParams.get("project") || null,
    }),
  }));
}
