import { ClerkProvider, UserButton } from "@clerk/nextjs";
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
  const canUsePrintQueue = Boolean(currentUser?.can_use_print_queue);
  const canShowTopbar = Boolean(currentUser?.is_manager || currentUser?.is_super_admin || canUsePrintQueue);
  const primaryNavItems = currentUser?.is_print_only ? [
    { href: "/print", label: "הדפסה" }
  ] : currentUser?.is_marei_mekomot ? [
    { href: "/announcements", label: "מראה מקומות" },
    { href: "/print", label: "הדפסה" }
  ] : [
    { href: "/neon", label: "תלמידים" },
    { href: "/email", label: "מיילים" },
    { href: "/announcements", label: "הודעות" },
    { href: "/attendance", label: "נוכחות" },
    { href: "/print", label: "הדפסה" }
  ];
  const secondaryNavItems = [
    { href: "/tasks", label: "משימות" },
    { href: "/payments", label: "מערכות תשלום" },
    ...(currentUser?.is_super_admin ? [{ href: "/admin", label: "ניהול" }] : []),
    ...(currentUser ? [{ href: "/account", label: "אזור אישי" }] : [])
  ];

  return (
    <html lang="he" dir="rtl">
      <body suppressHydrationWarning>
        <ClerkProvider>
          {canShowTopbar ? (
            <header className="topbar">
              <nav className="nav">
                {primaryNavItems.map((item) => (
                  <Link key={item.href} href={item.href}>{item.label}</Link>
                ))}
                {secondaryNavItems.length ? (
                  <details className="nav-more">
                    <summary aria-label="אפשרויות נוספות">...</summary>
                    <div className="nav-more-menu">
                      {secondaryNavItems.map((item) => (
                        <Link key={item.href} href={item.href}>{item.label}</Link>
                      ))}
                    </div>
                  </details>
                ) : null}
              </nav>
              <div style={{ display: "flex", gap: 8 }}>
                {currentUser ? <UserButton /> : null}
              </div>
            </header>
          ) : null}
          <main className="container">{children}</main>
          {canUseAiChat ? <AiChatWidget /> : null}
        </ClerkProvider>
      </body>
    </html>
  );
}
