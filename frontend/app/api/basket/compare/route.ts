// POST /api/basket/compare  ->  BasketResult   (body: BasketRequest)
// The basket comparison is Scoopt's key differentiator (see business plan).
import { NextResponse } from "next/server";
import { compareBasket } from "@/lib/fakeData";
import type { BasketRequest } from "@/contract/types";

export async function POST(req: Request) {
  const body = (await req.json()) as BasketRequest;
  if (!body?.items || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "Body must be { items: string[] }" }, { status: 400 });
  }
  return NextResponse.json(compareBasket(body));
}
