"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { currentAccount, subscribe } from "@/lib/auth";
import type { Account } from "@/contract/types";

export default function AccountNav() {
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    setAccount(currentAccount());
    return subscribe(setAccount);
  }, []);

  if (account) {
    return (
      <Link href="/profile" className="nav-profile">
        {account.name ? account.name : "My profile"}
      </Link>
    );
  }
  return (
    <Link href="/account" className="nav-profile">Sign in</Link>
  );
}
