import { handle, readJson } from "@/lib/http";
import { createTask, listTasks } from "@/lib/services";
import { currentUser } from "@/lib/session";

export async function GET() {
  return handle(async () => ({ tasks: await listTasks(await currentUser()) }));
}

export async function POST(req: Request) {
  return handle(async () => createTask(await currentUser(), await readJson(req)), 201);
}
