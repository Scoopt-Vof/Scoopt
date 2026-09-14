// ============================================================================
//  SUBCATEGORIES — the subcategory tiles the frontend offers per category
// ----------------------------------------------------------------------------
//  Used by the profile page (the per-category "set up" links) and as a
//  fallback name source for the subcategory page, so a subcategory the shopper
//  can start setting up preferences for still works even when the backend has
//  no PUBLISHED products in it yet (the old /api/category endpoint only lists
//  subcategories that already have products, which is why "Set up Bedroom"
//  could 404).
//
//  The ids match the keys in lib/subcategoryQuestions.ts and the English
//  subcategory ids the backend uses. Later this can come from the category tree
//  endpoint (GET /api/categories) so it is always in step with the backend.
// ============================================================================

import type { Category } from "@/contract/types";

export interface SubcategoryDef {
  id: string;
  name: string;
}

export const SUBCATEGORIES: Record<Category, SubcategoryDef[]> = {
  sport: [
    { id: "running", name: "Running" },
    { id: "cycling", name: "Cycling" },
    { id: "fitness-gym", name: "Fitness & gym" },
  ],
  home: [
    { id: "furniture", name: "Living room" },
    { id: "bedroom", name: "Bedroom" },
    { id: "kitchen-dining", name: "Kitchen & dining" },
  ],
  tech: [
    { id: "laptops-computers", name: "Laptops & computers" },
    { id: "smartphones", name: "Smartphones" },
  ],
};

export function findSubcategory(category: Category, id: string): SubcategoryDef | undefined {
  return SUBCATEGORIES[category]?.find((s) => s.id === id);
}
