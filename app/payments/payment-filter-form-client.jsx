"use client";

import { useEffect, useMemo, useState } from "react";

function clean(value) {
  return String(value || "").trim();
}

export default function PaymentFilterFormClient({
  reportType = "transactions",
  dateFrom,
  dateTo,
  mandateStatus = "ongoing",
  connections = [],
  selectedConnectionIds = []
}) {
  const allConnectionIds = useMemo(
    () => connections.map((connection) => clean(connection.id)).filter(Boolean),
    [connections]
  );

  const [selectedIds, setSelectedIds] = useState(
    selectedConnectionIds.length ? selectedConnectionIds : allConnectionIds
  );
  const [selectedMandateStatus, setSelectedMandateStatus] = useState(mandateStatus);

  useEffect(() => {
    setSelectedIds(selectedConnectionIds.length ? selectedConnectionIds : allConnectionIds);
  }, [selectedConnectionIds, allConnectionIds]);

  useEffect(() => {
    setSelectedMandateStatus(mandateStatus || "ongoing");
  }, [mandateStatus]);

  const allSelected = allConnectionIds.length > 0 && selectedIds.length === allConnectionIds.length;
  const hideDates = reportType === "mandates";

  function toggleAll() {
    setSelectedIds((current) => (current.length === allConnectionIds.length ? [] : allConnectionIds));
  }

  function toggleConnection(connectionId) {
    setSelectedIds((current) => (
      current.includes(connectionId)
        ? current.filter((item) => item !== connectionId)
        : [...current, connectionId]
    ));
  }

  return (
    <form method="get" style={{ display: "grid", gap: 16 }}>
      <input type="hidden" name="run" value="1" />
      <input type="hidden" name="reportType" value={reportType} />
      {!hideDates ? (
        <div className="grid">
          <input type="date" name="dateFrom" defaultValue={dateFrom} required />
          <input type="date" name="dateTo" defaultValue={dateTo} required />
        </div>
      ) : null}
      {hideDates ? (
        <>
          <div className="grid">
            <select
              name="mandateStatus"
              value={selectedMandateStatus}
              onChange={(event) => setSelectedMandateStatus(clean(event.target.value) || "active")}
            >
              <option value="ongoing">כל ההוראות הפעילות, כולל תקלות</option>
              <option value="active">הוראות פעילות ללא תקלות הדורשות טיפול</option>
              <option value="ending_soon">הצג הוראות קבע לקראת סיום</option>
              <option value="issues">הצג הוראות קבע עם תקלות</option>
              <option value="completed">הצג הוראות קבע שהסתיימו</option>
              <option value="external">הצג הוראות קבע ממערכת חיצונית</option>
              <option value="all">הצג את כל הוראות הקבע</option>
            </select>
          </div>
        </>
      ) : null}

      <div>
        <div className="muted" style={{ marginBottom: 8 }}>מערכות להפקת הדוח</div>
        <div className="email-filter-chip-list">
          <label className="email-filter-chip">
            <input
              className="email-filter-chip-input"
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
            />
            <span>כל המערכות</span>
          </label>
          {connections.map((connection) => (
            <label key={connection.id} className="email-filter-chip">
              <input
                className="email-filter-chip-input"
                type="checkbox"
                name="connectionId"
                value={connection.id}
                checked={selectedIds.includes(connection.id)}
                onChange={() => toggleConnection(connection.id)}
              />
              <span>{connection.label}</span>
            </label>
          ))}
        </div>
      </div>

      <button type="submit" disabled={!selectedIds.length}>
        {reportType === "mandates" ? "הפק דוח הוראות קבע" : "הפק דוח עסקאות"}
      </button>
    </form>
  );
}
