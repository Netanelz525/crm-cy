"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/attendance", label: "נוכחות", icon: "✓" },
  { href: "/neon", label: "תלמידים", icon: "♙" },
  { href: "/tasks", label: "משימות", icon: "☷" },
  { href: "/account", label: "החשבון שלי", icon: "◉" }
];

export default function MobileNavigation() {
  const pathname = usePathname();
  return <nav className="mobile-navigation" aria-label="ניווט ראשי בנייד">
    {items.map(({ href, label, icon }) => {
      const active = pathname === href || pathname.startsWith(`${href}/`);
      return <Link key={href} href={href} aria-current={active ? "page" : undefined}>
        <span aria-hidden="true">{icon}</span><span>{label}</span>
      </Link>;
    })}
  </nav>;
}
