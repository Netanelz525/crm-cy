"use client";

import { useEffect, useMemo, useState } from "react";

function clean(value) {
  return String(value || "").trim();
}

export default function PaymentFilterFormClient({
  reportType = "transactions",
  dateFrom,
  dateTo,
  mandateStatus = "active",
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
  const [selectedMandateStatus, setSelectedMandateStatus] = useState(mandateStatus);

  useEffect(() => {
    setSelectedIds(selectedConnectionIds.length ? selectedConnectionIds : allConnectionIds);
  }, [selectedConnectionIds, allConnectionIds]);

  useEffect(() => {
    setSelectedReportType(reportType);
  }, [reportType]);

  useEffect(() => {
    setSelectedMandateStatus(mandateStatus || "active");
  }, [mandateStatus]);

  const allSelected = allConnectionIds.length > 0 && selectedIds.length === allConnectionIds.length;
  const hideDates = selectedReportType === "mandates";

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
              <option value="active">הצג הוראות קבע פעילות</option>
              <option value="issues">הצג הוראות קבע עם תקלות</option>
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
        {selectedReportType === "mandates" ? "הפק דוח הוראות קבע פעילות" : "הפק דוח עסקאות"}
      </button>
    </form>
  );
}
