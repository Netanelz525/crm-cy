"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";

export default function RefreshAssignments() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const interval = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [router]);
  return <button type="button" disabled={pending} onClick={() => startTransition(() => router.refresh())}>{pending ? "מרענן…" : "רענן שיוכים למפגשים"}</button>;
}
