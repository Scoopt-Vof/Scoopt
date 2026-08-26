import type { Metadata } from "next";
import Link from "next/link";
import BasketCount from "@/components/BasketCount";
import SearchBox from "@/components/SearchBox";
import AccountNav from "@/components/AccountNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scoopt — Shop with knowledge, not guesswork",
  description:
    "Compare prices and whole baskets for sport, home & furniture and technology — with buying advice alongside.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="header-inner">
            <Link href="/" className="logo">
              Scoop<span>t</span>
            </Link>
            <SearchBox />
            <nav className="nav">
              <Link href="/category/home">Home &amp; furniture</Link>
              <Link href="/category/sport">Sport</Link>
              <Link href="/category/tech">Technology</Link>
              <AccountNav />
              <BasketCount />
            </nav>
          </div>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          Scoopt · price-comparison prototype · sample data
        </footer>
      </body>
    </html>
  );
}
