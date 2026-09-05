import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchCategory } from "@/lib/api";
import SubcategoryIntake from "@/components/SubcategoryIntake";
import type { Category } from "@/contract/types";

// The page a shopper lands on after clicking a subcategory tile (e.g.
// Home & furniture -> Living room). Validates both the category and the
// subcategory exist, then hands off to the intake form.
export default async function SubcategoryPage({
  params,
}: {
  params: Promise<{ cat: string; sub: string }>;
}) {
  const { cat, sub } = await params;
  const page = await fetchCategory(cat);
  if (!page) notFound();

  const subcategory = page.subcategories.find((s) => s.id === sub);
  if (!subcategory) notFound();

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
