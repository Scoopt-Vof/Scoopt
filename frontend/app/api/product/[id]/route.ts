// GET /api/product/:id  ->  ProductWithOffers  (see contract/types.ts)
import { proxy } from "@/lib/backend";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxy(`/api/product/${encodeURIComponent(id)}`, undefined, { catalog: true });
}
