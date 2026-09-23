"use client";

import { useState } from "react";

export default function ArticleSlugField({ defaultValue = "" }) {
  const [value, setValue] = useState(defaultValue);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function suggestSlug() {
    const form = document.activeElement?.form;
    const title = form?.querySelector('input[name="title"]')?.value?.trim() || "";
    if (!title) {
      setMessage("יש להזין כותרת לפני הצעת כתובת.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/articles/slug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.slug) throw new Error(payload.error || "לא ניתן ליצור כתובת.");
      setValue(payload.slug);
      setMessage("הוצעה כתובת באנגלית. אפשר לערוך אותה לפני השמירה.");
    } catch (error) {
      setMessage(error?.message || "לא ניתן ליצור כתובת.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <label className="knowledge-article-slug-field">
      <span>כתובת המאמר באנגלית</span>
      <div className="knowledge-article-slug-row">
        <input name="slug" value={value} onChange={(event) => setValue(event.target.value)} placeholder="example-article" dir="ltr" />
        <button type="button" className="quick-action-btn quick-action-outline" onClick={suggestSlug} disabled={loading}>
          {loading ? "מתרגם…" : "הצע כתובת מהכותרת"}
        </button>
      </div>
      <small className="muted">הכתובת תופיע אחרי ‎/articles/‎ ותכיל אותיות באנגלית, מספרים ומקפים בלבד.</small>
      {message ? <small className="muted" role="status">{message}</small> : null}
    </label>
  );
}
