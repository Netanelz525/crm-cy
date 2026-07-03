"use client";

import { useMemo, useState } from "react";

function clean(value) {
  return String(value || "").trim();
}

function userLabel(user) {
  const name = clean(user?.displayName);
  const email = clean(user?.email);
  return [name, email].filter(Boolean).join(" | ") || clean(user?.id) || "איש צוות";
}

export default function ResponsibleUserPicker({ users = [], defaultValue = "", defaultValues = [], name = "responsibleUserIds" }) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => {
    const values = Array.isArray(defaultValues) && defaultValues.length ? defaultValues : [defaultValue];
    return values.map(clean).filter(Boolean);
  });
  const normalizedQuery = clean(query).toLowerCase();
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
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

  function toggleUser(userId) {
    const normalizedUserId = clean(userId);
    if (!normalizedUserId) return;
    setSelectedIds((current) => (
      current.includes(normalizedUserId)
        ? current.filter((item) => item !== normalizedUserId)
        : [...current, normalizedUserId]
    ));
  }

  return (
    <div className="attendance-responsible-picker">
      <span className="muted">אנשי צוות אחראים</span>
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
      {!canSearch ? (
        <span className="attendance-responsible-empty">הקלד לפחות שתי אותיות כדי להציג אנשי צוות לבחירה.</span>
      ) : (
        <div className="attendance-responsible-list">
          {filteredUsers.map((user) => (
            <label key={user.id} className={`attendance-responsible-option${selectedSet.has(user.id) ? " active" : ""}`}>
              <input
                type="checkbox"
                checked={selectedSet.has(user.id)}
                onChange={() => toggleUser(user.id)}
              />
              <span>{userLabel(user)}</span>
            </label>
          ))}
        </div>
      )}
      {canSearch && !filteredUsers.length ? (
        <span className="attendance-responsible-empty">לא נמצאו אנשי צוות תואמים.</span>
      ) : null}
    </div>
  );
}
