"use client";
// Add/remove a product to the smart basket. Reflects current state so the
// button reads "In basket ✓" once added. Adding also emits an add_to_basket
// event (via the basket store) that feeds the profile.

import { useEffect, useState } from "react";
import { addToBasket, removeFromBasket, inBasket, subscribe } from "@/lib/basket";
import type { Category } from "@/contract/types";

export default function AddToBasket({
  productId,
  category,
}: {
  productId: string;
  category: Category;
}) {
  const [added, setAdded] = useState(false);

  useEffect(() => {
    setAdded(inBasket(productId));
    return subscribe(() => setAdded(inBasket(productId)));
  }, [productId]);

  return (
    <button
      className={added ? "btn-ghost" : "btn-cta"}
      style={{ marginTop: 4 }}
      onClick={() => (added ? removeFromBasket(productId) : addToBasket(productId, { category }))}
    >
      {added ? "In basket ✓ — remove" : "+ Add to smart basket"}
    </button>
  );
}
