"use client";

export default function AnnouncementPrintClient() {
  return (
    <button className="btn btn-primary announcement-print-btn" type="button" onClick={() => window.print()}>
      הדפס / שמור כ-PDF
    </button>
  );
}
