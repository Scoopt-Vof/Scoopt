// GET /api/category/:cat  ->  CategoryPage  (see contract/types.ts)
import { NextResponse } from "next/server";
import { getCategory } from "@/lib/fakeData";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cat: string }> }
) {
  const { cat } = await params;
  const page = getCategory(cat);
  if (!page) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }
  return NextResponse.json(page);
}
