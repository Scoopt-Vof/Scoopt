// GET /api/price-history/:id  ->  PriceHistory   (see contract/types.ts)
//
// Serves REAL stored observations only. This route previously generated a
// synthetic 30-day history with a wobble function, which made the "cheapest in
// 30 days" signal a fabrication. It now returns whatever the backend has
// actually recorded — including nothing, if nothing has been recorded yet.
import { proxy } from "@/lib/backend";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxy(`/api/price-history/${encodeURIComponent(id)}`, undefined, { catalog: true });
}
