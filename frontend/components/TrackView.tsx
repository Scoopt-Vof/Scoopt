"use client";
// Invisible component: records a "view_product" event when a product page
// mounts. Rendering nothing keeps it a pure side-effect. This is the frontend
// DETECTING behaviour — persistence is the seam inside lib/track.ts.

import { useEffect } from "react";
import { track } from "@/lib/track";
import type { Category } from "@/contract/types";

export default function TrackView({
  productId,
  category,
}: {
  productId: string;
  category: Category;
}) {
  useEffect(() => {
    track("view_product", productId, { category });
  }, [productId, category]);

  return null;
}
