"use client";

import { useMemo, useState } from "react";

function clean(value) {
  return String(value || "").trim();
}

function userLabel(user) {
  const name = clean(user?.displayName);
  const email = clean(user?.email);
  return [name, email].filter(Boolean).join(" | ") || clean(user?.id) || "משתמש";
}

function userKindLabel(user) {
  const role = clean(user?.role).toLowerCase();
  if (role === "admin" || role === "editor" || role === "super_admin" || clean(user?.linkedStudentClass).toUpperCase() === "TEAM") {
    return "צוות";
  }
  return user?.canCallAttendance === false ? "תלמיד · ללא הרשאת מוקד" : "תלמיד";
}

export default function ResponsibleUserPicker({
  users = [],
  students = [],
  defaultValue = "",
  defaultValues = [],
  name = "responsibleUserIds"
}) {
  const [query, setQuery] = useState("");
  const [institutionFilter, setInstitutionFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => {
    const values = Array.isArray(defaultValues) && defaultValues.length ? defaultValues : [defaultValue];
    return values.map(clean).filter(Boolean);
  });
  const normalizedQuery = clean(query).toLowerCase();
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const studentById = useMemo(() => new Map(
    (Array.isArray(students) ? students : [])
      .map((student) => [clean(student?.id), student])
      .filter(([id]) => id)
  ), [students]);
  const institutionOptions = useMemo(() => Array.from(new Set(
    (Array.isArray(students) ? students : [])
      .map((student) => clean(student?.institutionLabel))
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, "he")), [students]);
  const classOptions = useMemo(() => Array.from(new Set(
    (Array.isArray(students) ? students : [])
      .map((student) => clean(student?.classLabel))
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, "he")), [students]);
  const canSearch = normalizedQuery.length >= 2;
  const selectedUsers = useMemo(() => {
    const list = Array.isArray(users) ? users : [];
    return selectedIds.map((userId) => (
      list.find((user) => clean(user?.id) === userId) || { id: userId }
    ));
  }, [users, selectedIds]);
  const filteredUsers = useMemo(() => {
    const list = Array.isArray(users) ? users : [];
    if (!canSearch) return [];
    return list.filter((user) => {
      const text = [
        user?.displayName,
        user?.email,
        user?.role,
        user?.linkedStudentClass
      ].map(clean).join(" ").toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [users, normalizedQuery, canSearch]);
  const filteredResponsibleUsers = useMemo(() => {
    if (!institutionFilter && !classFilter) return [];
    return (Array.isArray(users) ? users : []).filter((user) => {
      const student = studentById.get(clean(user?.linkedStudentId));
      if (!student) return false;
      return (!institutionFilter || clean(student?.institutionLabel) === institutionFilter)
        && (!classFilter || clean(student?.classLabel) === classFilter);
    });
  }, [users, studentById, institutionFilter, classFilter]);

  function toggleUser(userId) {
    const normalizedUserId = clean(userId);
    if (!normalizedUserId) return;
    setSelectedIds((current) => (
      current.includes(normalizedUserId)
        ? current.filter((item) => item !== normalizedUserId)
        : [...current, normalizedUserId]
    ));
  }

  function addFilteredUsers() {
    const ids = filteredResponsibleUsers.map((user) => clean(user?.id)).filter(Boolean);
    if (!ids.length) return;
    setSelectedIds((current) => Array.from(new Set([...current, ...ids])));
  }

  return (
    <div className="attendance-responsible-picker">
      <span className="muted">אחראים להתקשרות</span>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="חפש לפי שם או מייל"
        autoComplete="off"
      />
      {selectedIds.map((userId) => <input key={userId} type="hidden" name={name} value={userId} />)}
      {selectedUsers.length ? (
        <div className="attendance-responsible-selected">
          {selectedUsers.map((user) => (
            <button key={`selected-${user.id}`} type="button" onClick={() => toggleUser(user.id)}>
              {userLabel(user)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="attendance-responsible-filter-box">
        <div className="attendance-responsible-filter-head">
          <strong>הוספה מהירה לפי מוסד ושיעור</strong>
          <span className="muted">הסינון כולל צוות וכל תלמיד עם משתמש מקושר. ביצוע שיחות בפועל דורש הרשאת מוקד נפרדת.</span>
        </div>
        <div className="attendance-responsible-filter-grid">
          <label>
            <span className="muted">מוסד</span>
            <select value={institutionFilter} onChange={(event) => setInstitutionFilter(event.target.value)}>
              <option value="">כל המוסדות</option>
              {institutionOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span className="muted">שיעור</span>
            <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
              <option value="">כל השיעורים</option>
              {classOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
        {institutionFilter || classFilter ? (
          <>
            <div className="attendance-responsible-filter-actions">
              <span className="muted">נמצאו {filteredResponsibleUsers.length} תלמידים ומשתמשים</span>
              <button type="button" className="quick-action-btn" onClick={addFilteredUsers} disabled={!filteredResponsibleUsers.length}>
                הוסף את כל התוצאות
              </button>
            </div>
            {filteredResponsibleUsers.length ? (
              <div className="attendance-responsible-list">
                {filteredResponsibleUsers.map((user) => {
                  const student = studentById.get(clean(user?.linkedStudentId));
                  return (
                    <label key={`filtered-${user.id}`} className={`attendance-responsible-option${selectedSet.has(user.id) ? " active" : ""}`}>
                      <input
                        type="checkbox"
                        checked={selectedSet.has(user.id)}
                        onChange={() => toggleUser(user.id)}
                      />
                      <span>{userLabel(user)}{student?.label ? ` · ${student.label}` : ""} · {userKindLabel(user)}</span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </>
        ) : (
          <span className="attendance-responsible-empty">בחר מוסד או שיעור כדי להציג תלמידים ומשתמשים רלוונטיים.</span>
        )}
      </div>
      {!canSearch ? (
        <span className="attendance-responsible-empty">הקלד לפחות שתי אותיות כדי להציג תלמידים ומשתמשים לבחירה.</span>
      ) : (
        <div className="attendance-responsible-list">
          {filteredUsers.map((user) => (
            <label key={user.id} className={`attendance-responsible-option${selectedSet.has(user.id) ? " active" : ""}`}>
              <input
                type="checkbox"
                checked={selectedSet.has(user.id)}
                onChange={() => toggleUser(user.id)}
              />
              <span>{userLabel(user)} · {userKindLabel(user)}</span>
            </label>
          ))}
        </div>
      )}
      {canSearch && !filteredUsers.length ? (
        <span className="attendance-responsible-empty">לא נמצאו תלמידים או משתמשים תואמים.</span>
      ) : null}
    </div>
  );
}
