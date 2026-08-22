// GET /api/price-history/:id  ->  PriceHistory   (see contract/types.ts)
//
// Powers honest signals like "cheapest it's been in 30 days". The business plan
// treats price history as a revenue stream that CANNOT be recreated later, so
// the backend must write one row per price refresh FROM DAY ONE. This route
// serves generated history today; Larry swaps getPriceHistory() for a real
// query over the stored observations.
import { NextResponse } from "next/server";
import { getPriceHistory } from "@/lib/fakeData";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const history = getPriceHistory(id);
  if (!history) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  return NextResponse.json(history);
}
