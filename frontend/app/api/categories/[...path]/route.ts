// GET /api/categories/<path...>            -> one node + children + breadcrumb
// GET /api/categories/<path...>/products   -> products in it AND below it, paged
// GET /api/categories/<path...>/facets     -> tag facet counts
//
// A catch-all, because a category path has slashes in it
// ("tech/audio-headphones") and the trailing segment decides which backend
// endpoint is meant. Same thin proxy as app/api/category/[cat]/route.ts — no
// logic here, and deliberately no local fallback: if the backend is not
// configured the page renders empty rather than inventing a catalogue.
import { proxy } from "@/lib/backend";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const search = new URL(req.url).search;
  const encoded = path.map(encodeURIComponent).join("/");
  return proxy(`/api/categories/${encoded}${search}`, undefined, { catalog: true });
}
