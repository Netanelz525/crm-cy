"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

export default function PendingSubmitButton({
  children,
  pendingText = "שולח...",
  className = "",
  disabled = false
}) {
  const { pending } = useFormStatus();
  const [submitted, setSubmitted] = useState(false);
  const isDisabled = disabled || pending || submitted;

  function handleClick(event) {
    if (isDisabled) {
      event.preventDefault();
      return;
    }
    const form = event.currentTarget.form;
    if (form && !form.checkValidity()) return;
    setSubmitted(true);
  }

  return (
    <button type="submit" className={className} disabled={isDisabled} aria-disabled={isDisabled} onClick={handleClick}>
      {pending || submitted ? pendingText : children}
    </button>
  );
}
