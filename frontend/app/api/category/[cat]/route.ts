// GET /api/category/:cat  ->  CategoryPage  (see contract/types.ts)
import { proxy } from "@/lib/backend";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cat: string }> }
) {
  const { cat } = await params;
  return proxy(`/api/category/${encodeURIComponent(cat)}`);
}
