// POST /api/basket/plan  ->  { items, deliveryRules }
// Returns the raw data the smart-split planner needs: each basket product with
// all its offers, plus the per-store delivery rules. The PLANNING itself runs
// in lib/smartBasket.ts (shared, pure) so it can run client- or server-side.
//
// Larry later swaps the fake sources for real feeds + real delivery rules;
// the response shape stays the same.
import { NextResponse } from "next/server";
import { basketItemsWithOffers, DELIVERY_RULES } from "@/lib/fakeData";
import type { BasketRequest } from "@/contract/types";

export async function POST(req: Request) {
  const body = (await req.json()) as BasketRequest;
  if (!body?.items || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "Body must be { items: string[] }" }, { status: 400 });
  }
  return NextResponse.json({
    items: basketItemsWithOffers(body.items),
    deliveryRules: DELIVERY_RULES,
  });
}
