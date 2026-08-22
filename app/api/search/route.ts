// GET /api/search?q=...  ->  Product[]  (see contract/types.ts)
import { NextResponse } from "next/server";
import { searchProducts } from "@/lib/fakeData";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  return NextResponse.json(searchProducts(q));
}
