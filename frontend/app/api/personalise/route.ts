// POST /api/personalise  ->  PersonalisedProduct[]   (body: PersonaliseRequest)
// Ranking runs against real products from the backend. The pure ranking engine
// still lives in lib/profile.ts and is used client-side by ForYou.
import { proxy } from "@/lib/backend";
import type { PersonaliseRequest } from "@/contract/types";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as PersonaliseRequest | null;
  if (!body?.productIds || !Array.isArray(body.productIds)) {
    return NextResponse.json({ error: "Body must be a PersonaliseRequest" }, { status: 400 });
  }
  return proxy("/api/personalise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
