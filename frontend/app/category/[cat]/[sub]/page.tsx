import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchCategory } from "@/lib/api";
import SubcategoryIntake from "@/components/SubcategoryIntake";
import { findSubcategory } from "@/lib/subcategories";
import type { Category } from "@/contract/types";

// The page a shopper lands on after clicking a subcategory tile (e.g.
// Home & furniture -> Living room). It renders the intake form even when the
// backend has no PUBLISHED products in this subcategory yet: the old behaviour
// 404'd for any subcategory the backend didn't already list (it builds that
// list from products), so "Set up Bedroom" from the profile page could dead-end.
export default async function SubcategoryPage({
  params,
}: {
  params: Promise<{ cat: string; sub: string }>;
}) {
  const { cat, sub } = await params;
  const page = await fetchCategory(cat);
  if (!page) notFound();

  // Prefer the backend's subcategory (it carries the real "essentials" list);
  // fall back to the frontend's known subcategories so the questionnaire still
  // works with no products yet. Only 404 if neither knows this subcategory.
  const backendSub = page.subcategories.find((s) => s.id === sub);
  const known = findSubcategory(page.category, sub);
  if (!backendSub && !known) notFound();

  const subcategory = {
    id: sub,
    name: backendSub?.name ?? known!.name,
    essentials: backendSub?.essentials ?? [],
  };

  return (
    <>
      <div className="crumb">
        <Link href="/">Home</Link> ›{" "}
        <Link href={`/category/${cat}`}>{page.name}</Link> ›{" "}
        <b>{subcategory.name}</b>
      </div>

      <h1 className="page-title">{subcategory.name}</h1>
      <p className="page-blurb">
        Part of {page.name} · tell us a bit more and we'll narrow it down
      </p>

      <SubcategoryIntake
        category={page.category as Category}
        subcategoryId={subcategory.id}
        subcategoryName={subcategory.name}
        essentials={subcategory.essentials}
      />
    </>
  );
}
