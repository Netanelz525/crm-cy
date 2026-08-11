"use client";

import { useMemo, useState } from "react";

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function compareText(left, right) {
  return normalize(left).localeCompare(normalize(right), "he", { numeric: true, sensitivity: "base" });
}

export default function ColumnPickerClient({ columns = [], selectedColumnKeys = [] }) {
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("default");
  const selectedSet = useMemo(() => new Set(selectedColumnKeys || []), [selectedColumnKeys]);
  const normalizedQuery = normalize(query);

  const orderedColumns = useMemo(() => {
    const withIndex = (columns || []).map((column, index) => ({ ...column, index }));
    return withIndex.sort((left, right) => {
      if (sortMode === "label-asc") return compareText(left.label, right.label) || left.index - right.index;
      if (sortMode === "label-desc") return compareText(right.label, left.label) || left.index - right.index;
      if (sortMode === "selected-first") {
        const selectedDiff = Number(selectedSet.has(right.key)) - Number(selectedSet.has(left.key));
        return selectedDiff || left.index - right.index;
      }
      if (sortMode === "empty-first") {
        const selectedDiff = Number(selectedSet.has(left.key)) - Number(selectedSet.has(right.key));
        return selectedDiff || left.index - right.index;
      }
      return left.index - right.index;
    });
  }, [columns, selectedSet, sortMode]);

  const visibleCount = orderedColumns.filter((column) => {
    if (!normalizedQuery) return true;
    return normalize(column.label).includes(normalizedQuery) || normalize(column.key).includes(normalizedQuery);
  }).length;

  return (
    <div className="column-picker-client">
      <div className="field-picker-toolbar">
        <label className="field-picker-search">
          <span>חיפוש שדה</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="שם שדה, טלפון, מוסד..."
          />
        </label>
        <div className="field-sort-buttons" aria-label="מיון שדות">
          <button type="button" className={sortMode === "default" ? "active" : ""} onClick={() => setSortMode("default")}>מקורי</button>
          <button type="button" className={sortMode === "label-asc" ? "active" : ""} onClick={() => setSortMode("label-asc")}>א-ב</button>
          <button type="button" className={sortMode === "label-desc" ? "active" : ""} onClick={() => setSortMode("label-desc")}>ת-א</button>
          <button type="button" className={sortMode === "selected-first" ? "active" : ""} onClick={() => setSortMode("selected-first")}>מסומנים</button>
          <button type="button" className={sortMode === "empty-first" ? "active" : ""} onClick={() => setSortMode("empty-first")}>לא מסומנים</button>
        </div>
        <div className="field-picker-count">
          מוצגים {visibleCount} מתוך {columns.length}
        </div>
      </div>
      <div className="column-grid field-picker-grid">
        {orderedColumns.map((col) => {
          const matches = !normalizedQuery || normalize(col.label).includes(normalizedQuery) || normalize(col.key).includes(normalizedQuery);
          return (
            <label key={col.key} className="column-item" style={matches ? undefined : { display: "none" }}>
              <input type="checkbox" name="cols" value={col.key} defaultChecked={selectedSet.has(col.key)} />
              <span>{col.label}</span>
            </label>
          );
        })}
      </div>
      {!visibleCount ? <div className="muted">לא נמצאו שדות מתאימים לחיפוש.</div> : null}
    </div>
  );
}
