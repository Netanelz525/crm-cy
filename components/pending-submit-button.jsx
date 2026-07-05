"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";

export default function PendingSubmitButton({
  children,
  pendingText = "שולח...",
  className = "",
  disabled = false
}) {
  const { pending } = useFormStatus();
  const clickLockedRef = useRef(false);
  const isDisabled = disabled || pending;

  function handleClick(event) {
    if (isDisabled) {
      event.preventDefault();
      return;
    }
    if (clickLockedRef.current) {
      event.preventDefault();
      return;
    }
    const form = event.currentTarget.form;
    if (form && !form.checkValidity()) return;
    clickLockedRef.current = true;
  }

  return (
    <button type="submit" className={className} disabled={isDisabled} aria-disabled={isDisabled} onClick={handleClick}>
      {pending ? pendingText : children}
    </button>
  );
}
