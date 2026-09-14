// ============================================================================
//  CATEGORIES — one source of truth for the three MVP categories
// ----------------------------------------------------------------------------
//  The category ids, labels and home-page blurbs used to be hardcoded
//  separately in the header (layout.tsx), the home page, the sign-up
//  questionnaire and the profile page — and they had already drifted apart
//  ("Home & furniture" vs "Home & Furniture"). Everything now imports from
//  here so a change is made once.
//
//  Later this can be driven by the backend category tree (GET /api/categories)
//  so labels match the database exactly; the shape below is what the UI needs.
// ============================================================================

import type { Category } from "@/contract/types";

export interface CategoryDef {
  id: Category;
  label: string;
  blurb: string;
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: "home",
    label: "Home & furniture",
    blurb: "Furnish every room and compare the same sofa or bed frame across every store.",
  },
  {
    id: "sport",
    label: "Sport",
    blurb: "Find the right gear for the sport you actually do, from your first running shoes to a home gym.",
  },
  {
    id: "tech",
    label: "Technology",
    blurb: "See what a laptop or phone really costs across every major store.",
  },
];

export const CATEGORY_LABELS: Record<Category, string> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.id] = c.label;
    return acc;
  },
  {} as Record<Category, string>
);
