import { ClerkProvider, SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "CRM Management",
  description: "CRM admin and student management"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body suppressHydrationWarning>
        <ClerkProvider>
          <header className="topbar">
            <nav className="nav">
              <Link href="/">תלמידים</Link>
              <Link href="/admin">ניהול</Link>
            </nav>
            <div style={{ display: "flex", gap: 8 }}>
              <SignedOut>
                <SignInButton />
                <SignUpButton />
              </SignedOut>
              <SignedIn>
                <UserButton />
              </SignedIn>
            </div>
          </header>
          <main className="container">{children}</main>
        </ClerkProvider>
      </body>
    </html>
  );
}
