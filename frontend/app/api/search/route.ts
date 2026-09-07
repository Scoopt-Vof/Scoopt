// GET /api/search?q=...  ->  Product[]  (see contract/types.ts)
import { proxy } from "@/lib/backend";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  return proxy(`/api/search?q=${encodeURIComponent(q)}`);
}
