import { handle } from "@/lib/http";
import { getKnowledgeProjects } from "@/lib/services";
import { currentUser } from "@/lib/session";

export async function GET() {
  return handle(async () => getKnowledgeProjects(await currentUser()));
}
