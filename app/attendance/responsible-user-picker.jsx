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
  const filteredUsers = useMemo(() => {
    const list = Array.isArray(users) ? users : [];
    if (!normalizedQuery) return list;
    return list.filter((user) => {
      const text = [
        user?.displayName,
        user?.email,
        user?.role,
        user?.linkedStudentClass
      ].map(clean).join(" ").toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [users, normalizedQuery]);

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
      {normalizedQuery && !filteredUsers.length ? (
        <span className="attendance-responsible-empty">לא נמצאו אנשי צוות תואמים.</span>
      ) : null}
    </div>
  );
}
