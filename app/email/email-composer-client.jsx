"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import Underline from "@tiptap/extension-underline";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { useEffect, useMemo, useState } from "react";
import AttachmentsInputClient from "./attachments-input-client";

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

function buildPreviewHtml({ subject, html }) {
  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
  <style>
    body { margin: 0; padding: 32px 16px; background: #f3f6fb; direction: rtl; text-align: right; font-family: Arial, Helvetica, sans-serif; color: #10243f; }
    .container { max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #d7e1ef; border-radius: 18px; overflow: hidden; direction: rtl; text-align: right; }
    .header { background: linear-gradient(180deg, #f8fbff, #eef6ff); padding: 26px 32px; border-bottom: 1px solid #d7e1ef; direction: rtl; text-align: right; }
    .title { margin: 0; font-size: 26px; line-height: 1.25; direction: rtl; text-align: right; }
    .content { padding: 30px 32px; font-size: 16px; line-height: 1.8; direction: rtl; text-align: right; }
    .content p, .content ul, .content ol, .content h2, .content h3, .content h4, .content h5, .content h6, .content li, .content div {
      margin: 0 0 18px;
      direction: rtl;
      text-align: right;
    }
  </style>
</head>
<body dir="rtl" align="right">
  <div class="container" dir="rtl" align="right">
    <div class="header" dir="rtl" align="right"><h1 class="title" dir="rtl" align="right">${escapeHtml(subject)}</h1></div>
    <div class="content" dir="rtl" align="right">${html}</div>
  </div>
</body>
</html>`;
}

function ToolButton({ active = false, icon, text, onClick, disabled = false }) {
  return (
    <button
      type="button"
      className={`announcement-tool-btn compact${active ? " active" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span>{icon}</span>
      <span>{text}</span>
    </button>
  );
}

export default function EmailComposerClient({
  hasRecipientSource,
  recipientMode,
  students,
  summary,
  initialSubject,
  initialHtml,
  initialSenderName,
  initialIncludeGreeting = true,
  senderNameEditable,
  resendConfigured
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [senderName, setSenderName] = useState(initialSenderName);
  const [includeGreeting, setIncludeGreeting] = useState(initialIncludeGreeting);
  const initialContent = useMemo(() => clean(initialHtml) || textToHtml(""), [initialHtml]);
  const [html, setHtml] = useState(initialContent);
  const [plainText, setPlainText] = useState(buildPlainText(initialContent));
  const [selectedIds, setSelectedIds] = useState(students.map((student) => student.id));

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
        class: "announcement-rich-editor email-rich-editor ProseMirror",
        dir: "rtl"
      }
    },
    onUpdate({ editor: currentEditor }) {
      const nextHtml = currentEditor.getHTML();
      setHtml(nextHtml);
      setPlainText(buildPlainText(nextHtml));
    }
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === initialContent) return;
    editor.commands.setContent(initialContent, { emitUpdate: false });
    setHtml(initialContent);
    setPlainText(buildPlainText(initialContent));
  }, [editor, initialContent]);

  useEffect(() => {
    setSelectedIds(students.map((student) => student.id));
  }, [students]);

  useEffect(() => {
    setIncludeGreeting(initialIncludeGreeting);
  }, [initialIncludeGreeting]);

  const previewHtml = useMemo(() => buildPreviewHtml({ subject, html }), [subject, html]);
  const selectedStudents = useMemo(
    () => students.filter((student) => selectedIds.includes(student.id)),
    [students, selectedIds]
  );
  const selectedRecipientCount = useMemo(() => {
    const emails = new Set();
    for (const student of selectedStudents) {
      if (recipientMode === "student" || recipientMode === "all") {
        const email = clean(student?.email?.primaryEmail).toLowerCase();
        if (email) emails.add(email);
      }
      if (recipientMode === "father" || recipientMode === "parents" || recipientMode === "all") {
        const email = clean(student?.fatherEmail?.primaryEmail).toLowerCase();
        if (email) emails.add(email);
      }
      if (recipientMode === "mother" || recipientMode === "parents" || recipientMode === "all") {
        const email = clean(student?.motherEmail?.primaryEmail).toLowerCase();
        if (email) emails.add(email);
      }
    }
    return emails.size;
  }, [selectedStudents, recipientMode]);

  function toggleStudent(studentId, checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(studentId);
      else next.delete(studentId);
      return Array.from(next);
      });
  }

  return (
    <div className="email-layout">
      <section className="email-panel">
        <div className="email-compose-card">
          <input type="hidden" name="contentHtml" value={html} />
          <input type="hidden" name="bodyText" value={plainText} />
          <input type="hidden" name="includeGreeting" value={includeGreeting ? "1" : "0"} />
          {selectedIds.map((id) => <input key={`selected-${id}`} type="hidden" name="studentIds" value={id} />)}

          <div className="email-section-title">
            <h2>תוכן המייל</h2>
            <span>{summary.recipientEmails} נמענים ייחודיים</span>
          </div>

          <label>
            שם השולח
            <input
              name="senderName"
              value={senderName}
              onChange={(event) => setSenderName(event.target.value)}
              readOnly={!senderNameEditable}
            />
          </label>
          <label>
            נושא
            <input name="subject" value={subject} onChange={(event) => setSubject(event.target.value)} required />
          </label>

          <div className="email-editor-card">
            <div className="announcement-toolbar quick">
              <ToolButton icon="🅱️" text="הדגש" disabled={!editor} active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()} />
              <ToolButton icon="〰️" text="קו" disabled={!editor} active={editor?.isActive("underline")} onClick={() => editor?.chain().focus().toggleUnderline().run()} />
              <ToolButton icon="🔠" text="כותרת" disabled={!editor} active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} />
              <ToolButton icon="•" text="רשימה" disabled={!editor} active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
              <ToolButton icon="➡️" text="ימין" disabled={!editor} active={editor?.isActive({ textAlign: "right" })} onClick={() => editor?.chain().focus().setTextAlign("right").run()} />
              <ToolButton icon="↔️" text="מרכז" disabled={!editor} active={editor?.isActive({ textAlign: "center" })} onClick={() => editor?.chain().focus().setTextAlign("center").run()} />
              <ToolButton icon="⬅️" text="שמאל" disabled={!editor} active={editor?.isActive({ textAlign: "left" })} onClick={() => editor?.chain().focus().setTextAlign("left").run()} />
            </div>
            <EditorContent editor={editor} />
          </div>

          <div className="email-help">
            אפשר להשתמש בתגיות: <code>{"{{שם}}"}</code>, <code>{"{{תלמיד}}"}</code>, <code>{"{{מוסד}}"}</code>, <code>{"{{שיעור}}"}</code>, <code>{"{{נמען}}"}</code>
          </div>

          <div className="email-send-scope">
            <label>
              <input type="radio" name="sendScope" value="selected" defaultChecked />
              שלח רק לתלמידים המסומנים
            </label>
            <label>
              <input type="radio" name="sendScope" value="filtered" />
              שלח לכל הרשימה המסוננת
            </label>
          </div>

          <div className="email-send-scope">
            <label>
              <input type="checkbox" checked={includeGreeting} onChange={(event) => setIncludeGreeting(event.target.checked)} />
              הוסף פנייה אישית
            </label>
          </div>

          <AttachmentsInputClient
            title="קבצים שיצורפו למייל"
            helperText="בחר כאן את הקבצים שיישמרו לטיוטה. במסך האישור הסופי רק תבדוק אותם ותאשר שליחה."
          />

          <details className="display-settings">
            <summary>
              {hasRecipientSource
                ? `בחירת תלמידים: ${selectedIds.length} מסומנים מתוך ${students.length}`
                : "בחירת תלמידים מתוך הסינון"}
            </summary>
            <div className="email-student-list">
              <div className="email-student-list-head">
                <strong>בחירת תלמידים</strong>
                <span>
                  {hasRecipientSource
                    ? `${selectedIds.length} מסומנים מתוך ${students.length} | ${summary.missingStudents} ללא כתובת מתאימה`
                    : "יש לבחור לפחות סינון אחד כדי להציג תלמידים"}
                </span>
              </div>
              {!hasRecipientSource ? (
                <div className="muted">לאחר בחירת מוסד, תווית, חיפוש או סינון אחר יוצגו כאן התלמידים המתאימים, ואז יהיה אפשר לבחור את כולם או רק חלק מהם.</div>
              ) : !students.length ? (
                <div className="muted">לא נמצאו תלמידים לפי הסינון שנבחר.</div>
              ) : (
                <>
                  <div className="quick-actions" style={{ marginTop: 0 }}>
                    <button type="button" className="chip-link" onClick={() => setSelectedIds(students.map((student) => student.id))}>
                      בחר את כל הרשימה המסוננת
                    </button>
                    <button type="button" className="chip-link" onClick={() => setSelectedIds([])}>
                      נקה בחירה
                    </button>
                  </div>
                  {students.map((student) => (
                    <label key={student.id} className={`email-student-row${student.hasBlacklistedEmail ? " email-student-row-blacklisted" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(student.id)}
                        onChange={(event) => toggleStudent(student.id, event.target.checked)}
                      />
                      <span>
                        <b>{student.label || student.name}</b>
                        <small>{student.currentInstitution || "-"} | {student.class || "-"} | {student.registration || "-"}</small>
                      </span>
                      <span className="email-recipient-pill">
                        {[
                          student?.email?.primaryEmail ? `תלמיד: ${student.email.primaryEmail}` : "",
                          student?.fatherEmail?.primaryEmail ? `אב: ${student.fatherEmail.primaryEmail}` : "",
                          student?.motherEmail?.primaryEmail ? `אם: ${student.motherEmail.primaryEmail}` : ""
                        ].filter(Boolean).join(" | ") || "אין כתובת מתאימה"}
                      </span>
                      {student.hasBlacklistedEmail ? (
                        <span className="email-recipient-pill email-recipient-pill-blacklisted">
                          חסום לשליחה: {student.blacklistedEmails.join(", ")}
                        </span>
                      ) : null}
                    </label>
                  ))}
                </>
              )}
            </div>
          </details>

          <div className="email-certainty-card">
            <h2>לפני מעבר לאישור סופי</h2>
            <div className="email-certainty-steps">
              <div><b>{selectedStudents.length}</b><span>תלמידים נבחרו</span><small>אפשר לשלוח לכל התלמידים המסוננים או רק למסומנים.</small></div>
              <div><b>{selectedRecipientCount}</b><span>נמענים ייחודיים</span><small>בדף הבא תראה את רשימת הנמענים הסופית לפני שליחה.</small></div>
            </div>
            <button type="submit" disabled={!resendConfigured || !hasRecipientSource || !selectedIds.length || !selectedRecipientCount}>
              מעבר לאישור סופי
            </button>
          </div>
        </div>
      </section>

      <aside className="email-panel">
        <div className="email-preview-card">
          <div className="email-section-title">
            <h2>תצוגה מקדימה</h2>
            <span>{senderName}</span>
          </div>
          <iframe srcDoc={previewHtml} title="Email preview" />
        </div>
      </aside>
    </div>
  );
}
