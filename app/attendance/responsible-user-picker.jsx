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

export default function ResponsibleUserPicker({ users = [], defaultValue = "" }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = clean(query).toLowerCase();
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

  return (
    <label className="attendance-responsible-picker">
      <span className="muted">איש צוות אחראי</span>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="חפש לפי שם או מייל"
        autoComplete="off"
      />
      <select name="responsibleUserId" defaultValue={defaultValue || ""}>
        <option value="">ללא אחראי</option>
        {filteredUsers.map((user) => (
          <option key={user.id} value={user.id}>{userLabel(user)}</option>
        ))}
      </select>
      {normalizedQuery && !filteredUsers.length ? (
        <span className="attendance-responsible-empty">לא נמצאו אנשי צוות תואמים.</span>
      ) : null}
    </label>
  );
}
