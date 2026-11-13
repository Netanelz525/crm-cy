'use client';
import { useId, useState } from 'react';

export default function PhoneWorkspace({ children, label }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className={`phone-workspace${open ? ' is-open' : ''}`}>
    <button type="button" className="phone-workspace-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{label}<span aria-hidden="true">{open ? '−' : '+'}</span></button>
    <div id={id} className="phone-workspace-body">{children}</div>
  </div>;
}
