"use client";

import { useEffect, useRef, useState } from "react";

function clean(value) {
  return String(value || "");
}

const TOOLBAR_ACTIONS = [
  { label: "🅱️", title: "הדגשה", command: "bold" },
  { label: "🔠", title: "כותרת גדולה", command: "formatBlock", value: "H2" },
  { label: "➡️", title: "יישור לימין", command: "justifyRight" },
  { label: "↔️", title: "מרכוז", command: "justifyCenter" },
  { label: "📝", title: "רשימה", command: "insertUnorderedList" }
];

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtml(value) {
  const text = clean(value);
  if (!text.trim()) return "";
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function htmlToText(value) {
  return clean(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export default function AnnouncementEditorClient({ namePrefix = "body", initialText = "", initialHtml = "" }) {
  const editorRef = useRef(null);
  const [html, setHtml] = useState(clean(initialHtml) || textToHtml(initialText));
  const [text, setText] = useState(clean(initialText) || htmlToText(initialHtml));

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.innerHTML !== html) {
      editor.innerHTML = html || "";
    }
  }, [html]);

  function syncFromEditor() {
    const editor = editorRef.current;
    if (!editor) return;
    const nextHtml = clean(editor.innerHTML);
    setHtml(nextHtml);
    setText(htmlToText(nextHtml));
  }

  function runCommand(command, value) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    if (command === "formatBlock") {
      document.execCommand(command, false, value);
    } else {
      document.execCommand(command, false);
    }
    syncFromEditor();
  }

  return (
    <div className="announcement-editor-shell">
      <div className="announcement-toolbar">
        {TOOLBAR_ACTIONS.map((action) => (
          <button
            key={action.title}
            type="button"
            className="announcement-tool-btn"
            title={action.title}
            onClick={() => runCommand(action.command, action.value)}
          >
            {action.label}
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        className="announcement-rich-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={syncFromEditor}
        onBlur={syncFromEditor}
      />
      <input type="hidden" name={`${namePrefix}Text`} value={text} />
      <input type="hidden" name={`${namePrefix}Html`} value={html} />
      <div className="muted">אפשר להדגיש, למרכז, להוסיף כותרת ורשימות. הגוף נשמר בפורמט עשיר ומתאים יותר להדפסה.</div>
    </div>
  );
}
