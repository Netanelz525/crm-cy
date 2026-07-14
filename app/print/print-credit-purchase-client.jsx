"use client";

import { useEffect, useRef, useState } from "react";

function clean(value) {
  return String(value || "").trim();
}

function formatAgorot(value) {
  const amount = Number(value || 0) / 100;
  return amount.toLocaleString("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 0 });
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(clean(data.error) || "הפעולה נכשלה.");
  return data;
}

async function getJson(url) {
  const response = await fetch(url, { method: "GET" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(clean(data.error) || "בדיקת סטטוס התשלום נכשלה.");
  return data;
}

export default function PrintCreditPurchaseClient({ packages }) {
  const frameRef = useRef(null);
  const transactionRef = useRef(null);
  const listenerReadyRef = useRef(false);
  const pollTimerRef = useRef(null);
  const [selectedPackageKey, setSelectedPackageKey] = useState(packages?.[0]?.key || "");
  const [intentId, setIntentId] = useState("");
  const [iframeUrl, setIframeUrl] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);

  const selectedPackage = packages.find((pack) => pack.key === selectedPackageKey);

  useEffect(() => {
    function postNedarim(data) {
      if (!frameRef.current?.contentWindow) return;
      frameRef.current.contentWindow.postMessage(data, "*");
    }

    function readPostMessage(event) {
      const message = event.data || {};
      if (!message || typeof message !== "object") return;

      switch (message.Name) {
        case "Height": {
          const height = Math.max(220, Number.parseInt(message.Value, 10) || 0);
          if (frameRef.current) frameRef.current.style.height = `${height + 15}px`;
          break;
        }
        case "ValidateFields":
          if (message.Value === "OK") {
            setStatus("מבצע חיוב בנדרים...");
            postNedarim({ Name: "FinishTransaction2", Value: transactionRef.current });
          } else {
            setBusy(false);
            setStatus("");
            setError("יש להשלים את פרטי האשראי באייפרם.");
          }
          break;
        case "TransactionResponse":
          if (message.Value?.Status === "Error") {
            setBusy(false);
            setStatus("");
            setError(clean(message.Value?.Message) || "החיוב לא אושר.");
          } else {
            setStatus("התשלום אושר. ממתין לאישור שרתי מנדרים כדי לעדכן את הקרדיט...");
            pollUntilApproved(intentId);
          }
          break;
        default:
          break;
      }
    }

    if (!listenerReadyRef.current) {
      window.addEventListener("message", readPostMessage);
      listenerReadyRef.current = true;
    }

    return () => {
      window.removeEventListener("message", readPostMessage);
      listenerReadyRef.current = false;
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }, [intentId]);

  function requestIframeHeight() {
    if (!frameRef.current?.contentWindow) return;
    frameRef.current.contentWindow.postMessage({ Name: "GetHeight" }, "*");
  }

  async function pollUntilApproved(id, attempt = 1) {
    if (!id) return;
    try {
      const data = await getJson(`/api/print-credit/nedarim/${encodeURIComponent(id)}`);
      if (data.intent?.status === "approved") {
        setApproved(true);
        setBusy(false);
        setStatus("הקרדיט עודכן בהצלחה. מרענן את הדף...");
        window.setTimeout(() => {
          window.location.href = "/print?credit=1";
        }, 900);
        return;
      }
      if (data.intent?.status === "failed") {
        setBusy(false);
        setStatus("");
        setError("התשלום לא אושר בנדרים.");
        return;
      }
      if (attempt >= 20) {
        setBusy(false);
        setStatus("התשלום התקבל באייפרם, אבל אישור השרת עדיין לא הגיע. הקרדיט יתעדכן כשנדרים ישלחו callback.");
        return;
      }
      pollTimerRef.current = window.setTimeout(() => pollUntilApproved(id, attempt + 1), 1500);
    } catch (pollError) {
      setBusy(false);
      setStatus("");
      setError(clean(pollError?.message) || "בדיקת התשלום נכשלה.");
    }
  }

  async function startPayment() {
    if (busy || !selectedPackage) return;
    setBusy(true);
    setError("");
    setApproved(false);
    setStatus("מכין דף חיוב...");

    try {
      const data = await postJson("/api/print-credit/nedarim", { packageKey: selectedPackage.key });
      setIntentId(data.intentId);
      setIframeUrl(data.iframeUrl);
      transactionRef.current = data.transaction;
      setStatus("הזן פרטי אשראי באייפרם ולחץ להמשך.");
      window.setTimeout(requestIframeHeight, 500);
    } catch (startError) {
      setBusy(false);
      setStatus("");
      setError(clean(startError?.message) || "פתיחת דף החיוב נכשלה.");
    }
  }

  function submitPayment() {
    if (!transactionRef.current || !frameRef.current?.contentWindow || approved) return;
    setBusy(true);
    setError("");
    setStatus("בודק את פרטי האשראי...");
    frameRef.current.contentWindow.postMessage({ Name: "ValidateFields" }, "*");
  }

  return (
    <div className="print-credit-purchase">
      <div className="print-credit-package-row">
        {packages.map((pack) => (
          <button
            key={pack.key}
            type="button"
            className={`print-credit-package${pack.key === selectedPackageKey ? " selected" : ""}`}
            onClick={() => {
              if (busy) return;
              setSelectedPackageKey(pack.key);
              setIframeUrl("");
              setIntentId("");
              transactionRef.current = null;
              setStatus("");
              setError("");
            }}
            disabled={busy}
          >
            <b>{pack.pages} דפים</b>
            <span>{formatAgorot(pack.amountAgorot)}</span>
          </button>
        ))}
      </div>

      {!iframeUrl ? (
        <button type="button" className="quick-action-btn quick-action-primary" onClick={startPayment} disabled={busy || !selectedPackage}>
          {busy ? "פותח חיוב..." : "קנה חבילת הדפסה"}
        </button>
      ) : (
        <div className="nedarim-payment-box">
          <iframe
            ref={frameRef}
            src={iframeUrl}
            title="תשלום נדרים פלוס"
            scrolling="no"
            onLoad={requestIframeHeight}
          />
          <button type="button" className="quick-action-btn quick-action-primary" onClick={submitPayment} disabled={busy && status !== "הזן פרטי אשראי באייפרם ולחץ להמשך."}>
            בצע תשלום ועדכן קרדיט
          </button>
        </div>
      )}

      {status ? <div className="ok" aria-live="polite">{status}</div> : null}
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}
