"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { useEffect, useMemo, useState } from "react";
import AnnouncementSheet from "./announcement-sheet";

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
  { icon: "⚫", text: "כהה", value: "#142642" },
  { icon: "🔵", text: "כחול", value: "#0c5fa8" },
  { icon: "🔴", text: "אדום", value: "#a43131" }
];

function ToolButton({ active = false, disabled = false, icon, text, title, onClick }) {
  return (
    <button
      type="button"
      className={`announcement-tool-btn${active ? " active" : ""}`}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      <span>{icon}</span>
      <span>{text}</span>
    </button>
  );
}

export default function AnnouncementEditorClient({
  namePrefix = "body",
  initialText = "",
  initialHtml = "",
  template,
  layout,
  placeholderText = "הקלד כאן את גוף המודעה",
  onChange
}) {
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
        class: "announcement-rich-editor announcement-rich-editor-inline ProseMirror",
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
      <div className="announcement-preview-shell">
        <AnnouncementSheet
          template={template}
          layout={layout}
          editableContent={<EditorContent editor={editor} />}
          placeholderText={placeholderText}
        />
      </div>

      <div className="announcement-toolbar-dock">
        <div className="announcement-toolbar-group">
          <div className="announcement-toolbar-label">עיצוב טקסט</div>
          <div className="announcement-toolbar">
            <ToolButton
              icon="🅱️"
              text="הדגשה"
              title="הדגשת הטקסט המסומן"
              disabled={!editor}
              active={editor?.isActive("bold")}
              onClick={() => editor?.chain().focus().toggleBold().run()}
            />
            <ToolButton
              icon="〰️"
              text="קו תחתון"
              title="קו תחתון לטקסט המסומן"
              disabled={!editor}
              active={editor?.isActive("underline")}
              onClick={() => editor?.chain().focus().toggleUnderline().run()}
            />
            <ToolButton
              icon="🔠"
              text="כותרת"
              title="הפיכת השורה לכותרת"
              disabled={!editor}
              active={editor?.isActive("heading", { level: 2 })}
              onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            />
            <ToolButton
              icon="•"
              text="רשימה"
              title="רשימת נקודות"
              disabled={!editor}
              active={editor?.isActive("bulletList")}
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
            />
            <ToolButton
              icon="➡️"
              text="ימין"
              title="יישור הפסקה הנבחרת לימין"
              disabled={!editor}
              active={editor?.isActive({ textAlign: "right" })}
              onClick={() => editor?.chain().focus().setTextAlign("right").run()}
            />
            <ToolButton
              icon="↔️"
              text="מרכז"
              title="יישור הפסקה הנבחרת למרכז"
              disabled={!editor}
              active={editor?.isActive({ textAlign: "center" })}
              onClick={() => editor?.chain().focus().setTextAlign("center").run()}
            />
            <ToolButton
              icon="⬅️"
              text="שמאל"
              title="יישור הפסקה הנבחרת לשמאל"
              disabled={!editor}
              active={editor?.isActive({ textAlign: "left" })}
              onClick={() => editor?.chain().focus().setTextAlign("left").run()}
            />
          </div>
        </div>

        <div className="announcement-toolbar-group">
          <div className="announcement-toolbar-label">צבע לטקסט מסומן</div>
          <div className="announcement-toolbar">
            {COLOR_OPTIONS.map((option) => (
              <ToolButton
                key={option.value}
                icon={option.icon}
                text={option.text}
                title={`צבע ${option.text}`}
                disabled={!editor}
                onClick={() => editor?.chain().focus().setColor(option.value).run()}
              />
            ))}
            <ToolButton
              icon="🧽"
              text="נקה צבע"
              title="הסרת צבע מהטקסט המסומן"
              disabled={!editor}
              onClick={() => editor?.chain().focus().unsetColor().run()}
            />
          </div>
        </div>
      </div>

      <input type="hidden" name={`${namePrefix}Text`} value={text} />
      <input type="hidden" name={`${namePrefix}Html`} value={html} />
      <div className="muted">הטקסט נערך ישירות על גבי הבלנק. סמן מילים או שורות כדי להחיל עיצוב ולראות מיד את התוצאה.</div>
    </div>
  );
}
