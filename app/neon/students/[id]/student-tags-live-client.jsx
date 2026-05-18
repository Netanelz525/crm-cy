"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { getStudentTagTheme } from "../../../../lib/student-tag-theme";
import { addStudentTagLiveAction, removeStudentTagLiveAction } from "../../student-live-actions";

function clean(value) {
  return String(value || "").trim();
}

export default function StudentTagsLiveClient({ studentId, initialTags = [], initialAvailableTags = [], canManageStudent = false }) {
  const [tags, setTags] = useState(Array.isArray(initialTags) ? initialTags : []);
  const [availableTags, setAvailableTags] = useState(Array.isArray(initialAvailableTags) ? initialAvailableTags : []);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const detailsRef = useRef(null);
  const formRef = useRef(null);

  const assignedIds = useMemo(() => new Set(tags.map((tag) => tag.id)), [tags]);
  const availableOptions = useMemo(
    () => availableTags.filter((tag) => !assignedIds.has(tag.id)),
    [availableTags, assignedIds]
  );

  function handleRemoveTag(tagId) {
    setMessage("");
    startTransition(async () => {
      const result = await removeStudentTagLiveAction({ studentId, tagId });
      if (!result?.ok) {
        setMessage(result?.error || "הסרת התווית נכשלה.");
        return;
      }
      setTags((current) => current.filter((tag) => tag.id !== tagId));
    });
  }

  function handleAddTag(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const tagId = clean(formData.get("tagId"));
    const newTagName = clean(formData.get("newTagName"));
    setMessage("");

    startTransition(async () => {
      const result = await addStudentTagLiveAction({ studentId, tagId, newTagName });
      if (!result?.ok || !result?.tag?.id) {
        setMessage(result?.error || "שמירת התווית נכשלה.");
        return;
      }
      setTags((current) => {
        if (current.some((tag) => tag.id === result.tag.id)) return current;
        return [...current, result.tag];
      });
      setAvailableTags((current) => {
        if (current.some((tag) => tag.id === result.tag.id)) return current;
        return [...current, result.tag].sort((a, b) => a.name.localeCompare(b.name, "he"));
      });
      formRef.current?.reset();
      if (detailsRef.current) detailsRef.current.open = false;
    });
  }

  return (
    <>
      <div className="student-meta-line student-tags-topline" style={{ marginTop: 10 }}>
        {tags.length ? (
          tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className="student-tag-chip-button"
              title={`הסר תווית ${tag.name}`}
              onClick={() => handleRemoveTag(tag.id)}
              disabled={isPending}
            >
              <span style={getStudentTagTheme(tag)}>{tag.name}</span>
              <span aria-hidden="true">×</span>
            </button>
          ))
        ) : (
          <span className="muted">עדיין לא שויכו תגיות לתלמיד הזה.</span>
        )}
        {canManageStudent ? (
          <details ref={detailsRef} className="student-tag-inline-panel">
            <summary className="student-tag-inline-trigger" title="הוסף תגית">
              <span aria-hidden="true">+</span>
            </summary>
            <div className="student-tag-quick-body student-tag-inline-body">
              <div className="muted">
                {availableOptions.length
                  ? "בחר תווית קיימת או צור תווית חדשה."
                  : "כל התוויות הקיימות כבר משויכות. אפשר ליצור תווית חדשה."}
              </div>
              <form ref={formRef} onSubmit={handleAddTag} className="student-tag-quick-form">
                <select name="tagId" defaultValue="" disabled={isPending}>
                  <option value="">בחר תווית קיימת</option>
                  {availableOptions.map((tag) => (
                    <option key={tag.id} value={tag.id}>{tag.name}</option>
                  ))}
                </select>
                <input name="newTagName" placeholder="או צור תווית חדשה" disabled={isPending} />
                <button type="submit" disabled={isPending}>{isPending ? "שומר..." : "שמור תווית"}</button>
              </form>
            </div>
          </details>
        ) : null}
      </div>
      {message ? <div className="student-inline-feedback">{message}</div> : null}
    </>
  );
}
