import { handle } from "@/lib/http";
import { listNotifications } from "@/lib/services";
import { currentUser } from "@/lib/session";

export async function GET() {
  return handle(async () => ({ notifications: await listNotifications(await currentUser()) }));
}
