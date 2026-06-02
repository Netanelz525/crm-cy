"use client";

import { useEffect, useMemo, useState } from "react";

function clean(value) {
  return String(value || "").trim();
}

export default function PaymentFilterFormClient({
  reportType = "transactions",
  dateFrom,
  dateTo,
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
  const [selectedReportType, setSelectedReportType] = useState(reportType);

  useEffect(() => {
    setSelectedIds(selectedConnectionIds.length ? selectedConnectionIds : allConnectionIds);
  }, [selectedConnectionIds, allConnectionIds]);

  useEffect(() => {
    setSelectedReportType(reportType);
  }, [reportType]);

  const allSelected = allConnectionIds.length > 0 && selectedIds.length === allConnectionIds.length;

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
      <div className="grid">
        <select
          name="reportType"
          value={selectedReportType}
          onChange={(event) => setSelectedReportType(clean(event.target.value) === "mandates" ? "mandates" : "transactions")}
        >
          <option value="transactions">דוח עסקאות</option>
          <option value="mandates">דוח הוראות קבע פעילות</option>
        </select>
      </div>
      <div className="grid">
        <input type="date" name="dateFrom" defaultValue={dateFrom} required />
        <input type="date" name="dateTo" defaultValue={dateTo} required />
      </div>

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
        {selectedReportType === "mandates" ? "הפק דוח הוראות קבע פעילות" : "הפק דוח עסקאות"}
      </button>
    </form>
  );
}
