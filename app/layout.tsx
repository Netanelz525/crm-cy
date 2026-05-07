import { ClerkProvider, SignedIn, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import AiChatWidget from "./ai-chat-widget";
import { getCurrentAppUser } from "../lib/rbac";
import "./globals.css";

export const metadata = {
  title: "CRM Management",
  description: "CRM admin and student management"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await getCurrentAppUser();
  const canUseAiChat = Boolean(currentUser?.is_team_member || currentUser?.is_manager);

  return (
    <html lang="he" dir="rtl">
      <body suppressHydrationWarning>
        <ClerkProvider>
          <header className="topbar">
            <nav className="nav">
              <Link href="/">תלמידים</Link>
              <Link href="/neon">Neon Beta</Link>
              <Link href="/email">מיילים</Link>
              <Link href="/announcements">הודעות</Link>
              <Link href="/attendance">נוכחות</Link>
              <Link href="/views">תצוגות</Link>
              <Link href="/admin">ניהול</Link>
              {currentUser ? <Link href="/account">אזור אישי</Link> : null}
            </nav>
            <div style={{ display: "flex", gap: 8 }}>
              <SignedIn>
                <UserButton />
              </SignedIn>
            </div>
          </header>
          <main className="container">{children}</main>
          {canUseAiChat ? (
            <SignedIn>
              <AiChatWidget />
            </SignedIn>
          ) : null}
        </ClerkProvider>
      </body>
    </html>
  );
}
