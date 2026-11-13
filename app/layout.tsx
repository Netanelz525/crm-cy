import { ClerkProvider, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import AiChatWidget from "./ai-chat-widget";
import MobileNavigation from "./mobile-navigation";
import { getCurrentAppUser } from "../lib/rbac";
import { canManagePersonalTools } from "../lib/personal-access";
import { canAccessCallDesk } from "../lib/attendance-calls";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "CRM Management",
  description: "CRM admin and student management"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const currentUser = await getCurrentAppUser();
  const canUseAiChat = canManagePersonalTools(currentUser);
  const canShowCallDesk = await canAccessCallDesk(currentUser);
  const canUsePrintQueue = Boolean(currentUser?.can_use_print_queue);
  const canShowTopbar = Boolean(currentUser);
  const isStudentPortalUser = Boolean(currentUser && !currentUser.is_team_member && !currentUser.is_manager && !currentUser.is_super_admin && !currentUser.is_print_only && !currentUser.is_marei_mekomot);
  const roleNavItems = isStudentPortalUser ? [
    { href: "/account", label: "אזור אישי" },
    { href: "/articles", label: "מרכז מידע" }
  ] : currentUser?.is_print_only ? [
    { href: "/print", label: "הדפסה" }
  ] : currentUser?.is_marei_mekomot ? [
    { href: "/announcements", label: "מראה מקומות" },
    { href: "/print", label: "הדפסה" }
  ] : [
    { href: "/neon", label: "תלמידים" },
    { href: "/email", label: "מיילים" },
    { href: "/announcements", label: "הודעות" },
    { href: "/attendance", label: "נוכחות" },
    ...(currentUser?.is_manager || currentUser?.is_team_member ? [{ href: "/detail-requests", label: "אימות פרטים" }] : []),
    { href: "/print", label: "הדפסה" }
  ];
  const primaryNavItems = [
    ...roleNavItems,
    ...(canManagePersonalTools(currentUser) ? [{ href: "/commands", label: "פקודות" }] : []),
    ...(canShowCallDesk ? [{ href: "/call-desk", label: "אזור השיחות שלי" }] : [])
  ];
  const secondaryNavItems = isStudentPortalUser ? [] : [
    ...(currentUser?.is_manager || currentUser?.is_super_admin ? [{ href: "/admin/articles", label: "מאמרי מידע" }] : []),
    { href: "/tasks", label: "משימות" },
    { href: "/payments", label: "מערכות תשלום" },
    ...(currentUser?.is_manager || currentUser?.is_super_admin ? [{ href: "/call-desk/manage", label: "ניהול שיחות" }] : []),
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
              <details className="phone-tools">
                <summary>כל הכלים <span aria-hidden="true">☰</span></summary>
                <nav aria-label="כל כלי המערכת">{[...primaryNavItems, ...secondaryNavItems].map(item => <Link key={item.href} href={item.href}>{item.label}</Link>)}</nav>
              </details>
              <div style={{ display: "flex", gap: 8 }}>
                {currentUser ? <UserButton /> : null}
              </div>
            </header>
          ) : null}
          <main className="container">{children}</main>
          {currentUser && !isStudentPortalUser && !currentUser.is_print_only && !currentUser.is_marei_mekomot ? <MobileNavigation /> : null}
          {canUseAiChat ? <AiChatWidget /> : null}
        </ClerkProvider>
      </body>
    </html>
  );
}
