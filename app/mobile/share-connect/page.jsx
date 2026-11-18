"use client";
import { useSignIn } from "@clerk/nextjs";
import { useEffect, useState } from "react";

export default function ShareConnect() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isLoaded) return;
    let busy = false;
    async function connect(event) {
      if (busy) return;
      busy = true;
      try {
        const response = await fetch("/api/mobile/share-session", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: event.detail?.token })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        const attempt = await signIn.create({ strategy: "ticket", ticket: result.ticket });
        if (attempt.status !== "complete") throw new Error("יש לחדש התחברות באפליקציה.");
        await setActive({ session: attempt.createdSessionId, navigate: async () => {
          window.location.replace("/mobile/import");
        } });
      } catch (failure) { setError(failure.message || "ההתחברות לשיתוף נכשלה."); }
    }
    window.addEventListener("crm-share-connect", connect);
    window.webkit?.messageHandlers?.mobileAuth?.postMessage("shareConnectReady");
    return () => window.removeEventListener("crm-share-connect", connect);
  }, [isLoaded, signIn, setActive]);
  return <section className="card"><h1>מתחברים לשיתוף</h1><p role="status">{error || "טוען את אפשרויות השיתוף…"}</p></section>;
}
