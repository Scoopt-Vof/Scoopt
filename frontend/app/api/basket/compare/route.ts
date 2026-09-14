// POST /api/basket/compare  ->  BasketResult   (body: BasketRequest)
import { proxy } from "@/lib/backend";
import type { BasketRequest } from "@/contract/types";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as BasketRequest | null;
  if (!body?.items || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "Body must be { items: string[] }" }, { status: 400 });
  }
  return proxy("/api/basket/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
