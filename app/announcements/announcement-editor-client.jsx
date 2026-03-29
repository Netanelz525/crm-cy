"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { useEffect, useMemo, useState } from "react";

function clean(value) {
  return String(value || "");
}

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
  if (!text.trim()) return "<p></p>";
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function buildPlainText(html) {
  return clean(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/p>\s*/gi, "\n\n")
    .replace(/<\/h[1-6]>\s*/gi, "\n\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const COLOR_OPTIONS = [
  { label: "⚫", value: "#142642", title: "כהה" },
  { label: "🔵", value: "#0c5fa8", title: "כחול" },
  { label: "🔴", value: "#a43131", title: "אדום" }
];

function ToolbarButton({ active = false, disabled = false, label, title, onClick }) {
  return (
    <button
      type="button"
      className={`announcement-tool-btn${active ? " active" : ""}`}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

export default function AnnouncementEditorClient({ namePrefix = "body", initialText = "", initialHtml = "", onChange }) {
  const initialContent = useMemo(() => clean(initialHtml) || textToHtml(initialText), [initialHtml, initialText]);
  const [html, setHtml] = useState(initialContent);
  const [text, setText] = useState(buildPlainText(initialContent));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [2, 3]
        }
      }),
      TextStyle,
      Color,
      Underline,
      TextAlign.configure({
        types: ["heading", "paragraph"]
      })
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: "announcement-rich-editor ProseMirror",
        dir: "rtl"
      }
    },
    onUpdate({ editor: currentEditor }) {
      const nextHtml = currentEditor.getHTML();
      setHtml(nextHtml);
      setText(buildPlainText(nextHtml));
    }
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === initialContent) return;
    editor.commands.setContent(initialContent, { emitUpdate: false });
    setHtml(initialContent);
    setText(buildPlainText(initialContent));
  }, [editor, initialContent]);

  useEffect(() => {
    onChange?.({ html, text });
  }, [html, text, onChange]);

  return (
    <div className="announcement-editor-shell">
      <div className="announcement-toolbar-group">
        <div className="announcement-toolbar-label">📝 עיצוב טקסט</div>
        <div className="announcement-toolbar">
          <ToolbarButton
            label="🅱️"
            title="הדגשה"
            disabled={!editor}
            active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          />
          <ToolbarButton
            label="〰️"
            title="קו תחתון"
            disabled={!editor}
            active={editor?.isActive("underline")}
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
          />
          <ToolbarButton
            label="🔠"
            title="כותרת"
            disabled={!editor}
            active={editor?.isActive("heading", { level: 2 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          />
          <ToolbarButton
            label="•"
            title="רשימה"
            disabled={!editor}
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
        </div>
      </div>

      <div className="announcement-toolbar-group">
        <div className="announcement-toolbar-label">↔️ יישור לפסקה הנבחרת</div>
        <div className="announcement-toolbar">
          <ToolbarButton
            label="➡️"
            title="ימין"
            disabled={!editor}
            active={editor?.isActive({ textAlign: "right" })}
            onClick={() => editor?.chain().focus().setTextAlign("right").run()}
          />
          <ToolbarButton
            label="↔️"
            title="מרכז"
            disabled={!editor}
            active={editor?.isActive({ textAlign: "center" })}
            onClick={() => editor?.chain().focus().setTextAlign("center").run()}
          />
          <ToolbarButton
            label="⬅️"
            title="שמאל"
            disabled={!editor}
            active={editor?.isActive({ textAlign: "left" })}
            onClick={() => editor?.chain().focus().setTextAlign("left").run()}
          />
        </div>
      </div>

      <div className="announcement-toolbar-group">
        <div className="announcement-toolbar-label">🎨 צבע לטקסט מסומן</div>
        <div className="announcement-toolbar">
          {COLOR_OPTIONS.map((option) => (
            <ToolbarButton
              key={option.value}
              label={option.label}
              title={option.title}
              disabled={!editor}
              onClick={() => editor?.chain().focus().setColor(option.value).run()}
            />
          ))}
          <ToolbarButton
            label="🧽"
            title="נקה צבע"
            disabled={!editor}
            onClick={() => editor?.chain().focus().unsetColor().run()}
          />
        </div>
      </div>

      <EditorContent editor={editor} />
      <input type="hidden" name={`${namePrefix}Text`} value={text} />
      <input type="hidden" name={`${namePrefix}Html`} value={html} />
      <div className="muted">בחר טקסט ואז החל עליו הדגשה, צבע, כותרת, רשימה או יישור. התצוגה המקדימה מתעדכנת מיד.</div>
    </div>
  );
}
