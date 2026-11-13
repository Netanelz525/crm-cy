"use client";
import { useSignIn } from '@clerk/nextjs';
import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    webkit?: { messageHandlers?: { mobileAuth?: { postMessage: (message: string) => void } } };
  }
}

export default function MobileFinish() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const busy = useRef(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isLoaded) return;
    async function finish(event: Event) {
      if (busy.current) return;
      busy.current = true;
      window.webkit?.messageHandlers?.mobileAuth?.postMessage("exchange-start");
      try {
        const detail = (event as CustomEvent).detail;
        const response = await fetch('/api/mobile/redeem', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: detail?.code, verifier: detail?.verifier })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        window.webkit?.messageHandlers?.mobileAuth?.postMessage("exchange-ok");
        if (result.sessionActive) {
          window.webkit?.messageHandlers?.mobileAuth?.postMessage("session-active");
          window.location.replace('/attendance');
          return;
        }
        const attempt = await signIn!.create({ strategy: 'ticket', ticket: result.ticket });
        if (attempt.status !== 'complete' || !attempt.createdSessionId) throw new Error('יש להשלים כניסה מחדש.');
        await setActive!({
          session: attempt.createdSessionId,
          navigate: async () => {
            window.webkit?.messageHandlers?.mobileAuth?.postMessage("session-active");
            window.location.replace('/attendance');
          }
        });
      } catch {
        window.webkit?.messageHandlers?.mobileAuth?.postMessage("exchange-failed");
        setError('לא ניתן להשלים כניסה. לחצו על התחברות מחדש באפליקציה.');
      }
    }
    window.addEventListener('crm-mobile-auth', finish);
    window.webkit?.messageHandlers?.mobileAuth?.postMessage('ready');
    return () => window.removeEventListener('crm-mobile-auth', finish);
  }, [isLoaded, signIn, setActive]);
  return <section className="card" role="status"><h1>מתחברים ל־CRM</h1><p>{error || 'משלימים את הכניסה המאובטחת…'}</p></section>;
}
