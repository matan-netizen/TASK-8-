import { handle } from "@/lib/http";
import { getKnowledgeOverview } from "@/lib/services";
import { currentUser } from "@/lib/session";

export async function GET() {
  return handle(async () => getKnowledgeOverview(await currentUser()));
}
