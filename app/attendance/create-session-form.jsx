"use client";

import { useState, useTransition } from "react";

export default function CreateSessionForm({ action, children }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const formData = new FormData(event.currentTarget);
    if (!formData.get("sessionType") && !formData.get("templateSessionId")) {
      setError("בחר סוג מפגש או מבנה ממפגש קודם לפני יצירת מפגש.");
      event.currentTarget.querySelector('input[name="sessionType"]')?.focus();
      return;
    }
    setError("");
    startTransition(async () => {
      const result = await action(formData);
      setError(result?.error || "");
    });
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={pending}>
      <fieldset disabled={pending} className="grid attendance-collapsible-body" style={{ border: 0, padding: 0, marginInline: 0, minWidth: 0 }}>
        {children}
        {error ? <p role="alert" style={{ gridColumn: "1 / -1", color: "#b91c1c" }}>{error}</p> : null}
        <button type="submit">{pending ? "יוצר מפגש…" : "צור מפגש והתחל להזין"}</button>
      </fieldset>
    </form>
  );
}
