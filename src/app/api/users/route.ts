import { handle } from "@/lib/http";
import { DEMO_USERS } from "@/lib/users";

export async function GET() {
  return handle(async () => ({ users: DEMO_USERS }));
}
