// GET /api/product/:id  ->  ProductWithOffers  (see contract/types.ts)
//
// This route is a thin wrapper. Today it reads from fake data; when the real
// backend exists, Larry changes only the getProduct import below to a real
// database query. The response SHAPE never changes, so the frontend is untouched.

import { NextResponse } from "next/server";
import { getProduct } from "@/lib/fakeData";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = getProduct(id);
  if (!result) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
