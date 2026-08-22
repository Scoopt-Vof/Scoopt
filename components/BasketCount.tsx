"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getBasket, subscribe } from "@/lib/basket";

export default function BasketCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(getBasket().length);
    return subscribe((ids) => setCount(ids.length));
  }, []);

  return (
    <Link href="/basket" className="nav-basket">
      Basket{count > 0 && <span className="basket-badge">{count}</span>}
    </Link>
  );
}
