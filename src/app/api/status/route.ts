import { handle } from "@/lib/http";
import { aiMode } from "@/lib/ai";

export async function GET() {
  return handle(async () => ({ aiMode: aiMode() }));
}
