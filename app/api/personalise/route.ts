// POST /api/personalise  ->  PersonalisedProduct[]   (body: PersonaliseRequest)
//
// The SERVER side of personalisation. Today ranking runs on the client
// (lib/profile.ts). This route reuses the SAME pure engine so results are
// identical, and gives Larry a place to later rank server-side using OBSERVED
// behaviour stored per-account — without changing the PersonalisedProduct shape.
import { NextResponse } from "next/server";
import { personalise } from "@/lib/profile";
import { searchProducts } from "@/lib/fakeData";
import type { PersonaliseRequest } from "@/contract/types";

export async function POST(req: Request) {
  const body = (await req.json()) as PersonaliseRequest;
  if (!body?.productIds || !Array.isArray(body.productIds)) {
    return NextResponse.json({ error: "Body must be a PersonaliseRequest" }, { status: 400 });
  }
  const all = searchProducts("");
  const products = body.productIds
    .map((id) => all.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const ranked = personalise(products, body.profile ?? null, body.observed ?? null);
  return NextResponse.json(ranked);
}
