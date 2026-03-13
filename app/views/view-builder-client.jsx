"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteStudentViewAction, saveStudentViewAction } from "../actions";

function clean(value) {
  return String(value || "").trim();
}

function buildQueryString(params) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.map(clean).filter(Boolean).forEach((item) => sp.append(key, item));
      return;
    }
    const next = clean(value);
    if (next) sp.set(key, next);
  });
  return sp.toString();
}

function parseColumns(raw) {
  return Array.isArray(raw) ? raw.map(clean).filter(Boolean) : [];
}

function parseSortLevels(rawLevels) {
  if (Array.isArray(rawLevels) && rawLevels.length) {
    return rawLevels.map((item, index) => ({
      id: `sort-${index + 1}`,
      sortBy: clean(item?.sortBy) || "class",
      sortDir: clean(item?.sortDir).toLowerCase() === "desc" ? "desc" : "asc"
    }));
  }
  return [{ id: "sort-1", sortBy: "class", sortDir: "asc" }];
}

let localSequence = 0;

function nextLocalId(prefix) {
  localSequence += 1;
  return `${prefix}-${localSequence}`;
}

function createFilter(seed = "") {
  return {
    id: nextLocalId(seed || "filter"),
    joiner: "AND",
    field: "",
    operator: "contains",
    value: ""
  };
}

function createGroup(index = 1) {
  return {
    id: nextLocalId(`group-${index}`),
    groupJoiner: "AND",
    filters: [createFilter(`g${index}`)]
  };
}

function createSortLevel(index = 1) {
  return {
    id: nextLocalId(`sort-${index}`),
    sortBy: "class",
    sortDir: "asc"
  };
}

function parseGroups(rawFilters) {
  if (!Array.isArray(rawFilters) || !rawFilters.length) return [createGroup(1)];

  const groups = [];
  const groupMap = new Map();

  rawFilters.forEach((item, index) => {
    const groupId = clean(item?.groupId) || "group-1";
    if (!groupMap.has(groupId)) {
      const nextGroup = {
        id: groupId,
        groupJoiner: clean(item?.groupJoiner).toUpperCase() === "OR" ? "OR" : "AND",
        filters: []
      };
      groupMap.set(groupId, nextGroup);
      groups.push(nextGroup);
    }

    groupMap.get(groupId).filters.push({
      id: nextLocalId(`${groupId}-${index}`),
      joiner: clean(item?.joiner).toUpperCase() === "OR" ? "OR" : "AND",
      field: clean(item?.field),
      operator: clean(item?.operator) || "contains",
      value: clean(item?.value)
    });
  });

  return groups.length ? groups : [createGroup(1)];
}

function flattenGroups(groups) {
  return groups.flatMap((group) =>
    group.filters
      .filter((filter) => clean(filter.field) && (["empty", "not_empty"].includes(filter.operator) || clean(filter.value)))
      .map((filter, index) => ({
        ...filter,
        groupId: group.id,
        groupJoiner: group.groupJoiner,
        joiner: index === 0 ? "AND" : filter.joiner
      }))
  );
}

function normalizeOptionText(value) {
  return clean(value).toLowerCase();
}

function SearchableFieldPicker({ options, value, onSelect, placeholder, listId }) {
  const [query, setQuery] = useState("");
  const activeOption = useMemo(
    () => options.find((option) => option.key === value) || null,
    [options, value]
  );
  const inputValue = query || activeOption?.label || value || "";
  const filteredOptions = useMemo(() => {
    const term = normalizeOptionText(query);
    if (!term) return options.slice(0, 12);
    return options
      .filter((option) => normalizeOptionText(`${option.label} ${option.key}`).includes(term))
      .slice(0, 12);
  }, [options, query]);

  function applySelection(rawValue) {
    const normalized = normalizeOptionText(rawValue);
    const match = options.find((option) => normalizeOptionText(option.label) === normalized || normalizeOptionText(option.key) === normalized);
    if (match) {
      onSelect(match.key);
      setQuery("");
      return;
    }
    setQuery(rawValue);
  }

  return (
    <div className="searchable-field-picker">
      <input
        list={listId}
        value={inputValue}
        onChange={(event) => applySelection(event.target.value)}
        onBlur={() => setQuery("")}
        placeholder={placeholder}
      />
      <datalist id={listId}>
        {filteredOptions.map((option) => (
          <option key={option.key} value={option.label}>{option.key}</option>
        ))}
      </datalist>
      {query ? <div className="searchable-field-hint">{filteredOptions.length ? filteredOptions.map((option) => option.label).join(" | ") : "לא נמצאה התאמה"}</div> : null}
    </div>
  );
}

export default function ViewBuilderClient({
  savedViews,
  currentViewId,
  status,
  currentQueryString,
  columnOptions,
  filterFieldOptions,
  filterOperatorOptions,
  filterValueOptions,
  sortOptions,
  preview,
  initialState,
  exportHref
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [fieldSearch, setFieldSearch] = useState("");
  const [viewSearch, setViewSearch] = useState("");
  const [activePanel, setActivePanel] = useState("saved");
  const deferredFieldSearch = useDeferredValue(fieldSearch);
  const deferredViewSearch = useDeferredValue(viewSearch);
  const [state, setState] = useState({
    cols: parseColumns(initialState.cols),
    groups: parseGroups(initialState.filters),
    sortLevels: parseSortLevels(initialState.sortLevels)
  });

  const columnLabelMap = useMemo(() => Object.fromEntries((columnOptions || []).map((option) => [option.key, option.label])), [columnOptions]);
  const sortLabelMap = useMemo(() => Object.fromEntries((sortOptions || []).map((option) => [option.key, option.label])), [sortOptions]);
  const filterFieldLabelMap = useMemo(() => Object.fromEntries((filterFieldOptions || []).map((option) => [option.key, option.label])), [filterFieldOptions]);

  const visibleColumns = useMemo(() => {
    const term = clean(deferredFieldSearch).toLowerCase();
    if (!term) return columnOptions;
    return columnOptions.filter((option) => clean(option.label).toLowerCase().includes(term) || clean(option.key).toLowerCase().includes(term));
  }, [columnOptions, deferredFieldSearch]);

  const flattenedFilters = useMemo(() => flattenGroups(state.groups), [state.groups]);

  const groupedSavedViews = useMemo(() => {
    const term = clean(deferredViewSearch).toLowerCase();
    const filtered = (savedViews || []).filter((view) => {
      const haystack = `${clean(view.name)} ${clean(view.folder_name)}`.toLowerCase();
      return !term || haystack.includes(term);
    });

    const groups = new Map();
    filtered.forEach((view) => {
      const folderName = clean(view.folder_name) || "ללא תיקיה";
      if (!groups.has(folderName)) groups.set(folderName, []);
      groups.get(folderName).push(view);
    });

    return Array.from(groups.entries())
      .map(([folderName, views]) => ({ folderName, views }))
      .sort((left, right) => left.folderName.localeCompare(right.folderName, "he"));
  }, [savedViews, deferredViewSearch]);

  const visibleColumnLabels = useMemo(
    () => state.cols.map((key) => columnLabelMap[key] || key).filter(Boolean),
    [columnLabelMap, state.cols]
  );

  const sortSummary = useMemo(
    () => state.sortLevels
      .map((level, index) => `${index + 1}. ${sortLabelMap[level.sortBy] || level.sortBy} ${level.sortDir === "desc" ? "יורד" : "עולה"}`)
      .join(" | "),
    [sortLabelMap, state.sortLevels]
  );

  const filterSummary = useMemo(() => {
    if (!flattenedFilters.length) return ["ללא תנאים פעילים"];
    return flattenedFilters.slice(0, 4).map((filter) => filterFieldLabelMap[filter.field] || filter.field);
  }, [filterFieldLabelMap, flattenedFilters]);

  const previewQuery = useMemo(() => buildQueryString({
    mode: "institution",
    sortBy: state.sortLevels[0]?.sortBy || "class",
    sortDir: state.sortLevels[0]?.sortDir || "asc",
    sby: state.sortLevels.map((level) => level.sortBy),
    sdir: state.sortLevels.map((level) => level.sortDir),
    cols: state.cols,
    ff: flattenedFilters.map((filter) => filter.field),
    fo: flattenedFilters.map((filter) => filter.operator),
    fv: flattenedFilters.map((filter) => filter.value),
    fj: flattenedFilters.map((filter) => filter.joiner),
    fg: flattenedFilters.map((filter) => filter.groupId),
    gj: flattenedFilters.map((filter) => filter.groupJoiner)
  }), [flattenedFilters, state.cols, state.sortLevels]);

  const activeView = savedViews.find((view) => view.id === currentViewId) || null;
  const returnPath = previewQuery ? `/views?${previewQuery}` : "/views";
  const panelTabs = [
    { key: "saved", label: "תצוגות" },
    { key: "sort", label: "מיון" },
    { key: "columns", label: "עמודות" },
    { key: "filters", label: "סינון" }
  ];

  function toggleColumn(columnKey) {
    setState((current) => ({
      ...current,
      cols: current.cols.includes(columnKey)
        ? current.cols.filter((key) => key !== columnKey)
        : [...current.cols, columnKey]
    }));
  }

  function updateGroup(groupIndex, patch) {
    setState((current) => ({
      ...current,
      groups: current.groups.map((group, index) => index === groupIndex ? { ...group, ...patch } : group)
    }));
  }

  function updateFilter(groupIndex, filterIndex, patch) {
    setState((current) => ({
      ...current,
      groups: current.groups.map((group, index) => {
        if (index !== groupIndex) return group;
        return {
          ...group,
          filters: group.filters.map((filter, innerIndex) => innerIndex === filterIndex ? { ...filter, ...patch } : filter)
        };
      })
    }));
  }

  function addGroup() {
    setState((current) => ({
      ...current,
      groups: [...current.groups, createGroup(current.groups.length + 1)]
    }));
  }

  function removeGroup(groupIndex) {
    setState((current) => {
      if (current.groups.length === 1) return { ...current, groups: [createGroup(1)] };
      return { ...current, groups: current.groups.filter((_, index) => index !== groupIndex) };
    });
  }

  function addFilter(groupIndex) {
    setState((current) => ({
      ...current,
      groups: current.groups.map((group, index) => index === groupIndex ? { ...group, filters: [...group.filters, createFilter(`g${groupIndex + 1}`)] } : group)
    }));
  }

  function removeFilter(groupIndex, filterIndex) {
    setState((current) => ({
      ...current,
      groups: current.groups.map((group, index) => {
        if (index !== groupIndex) return group;
        if (group.filters.length === 1) return { ...group, filters: [createFilter(`g${groupIndex + 1}`)] };
        return { ...group, filters: group.filters.filter((_, innerIndex) => innerIndex !== filterIndex) };
      })
    }));
  }

  function addSortLevel() {
    setState((current) => ({
      ...current,
      sortLevels: [...current.sortLevels, createSortLevel(current.sortLevels.length + 1)]
    }));
  }

  function updateSortLevel(index, patch) {
    setState((current) => ({
      ...current,
      sortLevels: current.sortLevels.map((level, levelIndex) => levelIndex === index ? { ...level, ...patch } : level)
    }));
  }

  function removeSortLevel(index) {
    setState((current) => {
      if (current.sortLevels.length === 1) return { ...current, sortLevels: [createSortLevel(1)] };
      return { ...current, sortLevels: current.sortLevels.filter((_, levelIndex) => levelIndex !== index) };
    });
  }

  function previewInBuilder() {
    startTransition(() => {
      router.push(returnPath);
    });
  }

  function applyView() {
    startTransition(() => {
      router.push(previewQuery ? `/?${previewQuery}` : "/");
    });
  }

  function viewHref(view) {
    return view?.query_string ? `/views?${view.query_string}&savedViewId=${view.id}` : "/views";
  }

  return (
    <div className="views-workspace views-workspace-compact">
      <aside className="views-sidebar card glass">
        <div className="views-sidebar-top">
          <div>
            <div className="views-sidebar-kicker">CRM Views</div>
            <h1>בונה תצוגות</h1>
            <p className="muted">אזור הניהול נשאר קומפקטי בצד, והתלמידים מוצגים בנוחות במרכז המסך.</p>
          </div>

          <div className="views-sidebar-actions">
            <Link className="quick-action-btn quick-action-outline" href="/">חזור לתלמידים</Link>
            <a className="quick-action-btn quick-action-outline" href={exportHref}>ייצוא לאקסל</a>
            <button type="button" className="quick-action-btn quick-action-outline" onClick={previewInBuilder} disabled={isPending}>רענן מקדימה</button>
            <button type="button" className="quick-action-btn quick-action-primary" onClick={applyView} disabled={isPending}>החל במסך תלמידים</button>
          </div>
        </div>

        <div className="views-sidebar-block views-sidebar-block-static">
          <div className="views-sidebar-section-head">
            <h3>סיכום תצוגה</h3>
            {activeView ? <div className="meta-chip meta-chip-strong">{activeView.name}</div> : <div className="meta-chip">טיוטה חדשה</div>}
          </div>
          <div className="views-summary-stack">
            <div className="views-summary-item"><strong>{state.groups.length}</strong><span>קבוצות תנאים</span></div>
            <div className="views-summary-item"><strong>{flattenedFilters.length}</strong><span>תנאים פעילים</span></div>
            <div className="views-summary-item"><strong>{state.cols.length}</strong><span>עמודות מוצגות</span></div>
            <div className="views-summary-item views-summary-wide"><strong>{sortSummary}</strong><span>רמות מיון</span></div>
          </div>
        </div>

        <div className="views-panel-tabs">
          {panelTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`views-panel-tab ${activePanel === tab.key ? "active" : ""}`}
              onClick={() => setActivePanel(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activePanel === "saved" ? (
          <div className="views-sidebar-block views-panel-surface">
            <div className="views-sidebar-section-head">
              <h3>תצוגות שמורות</h3>
              <span className="muted">תיקיות וחיפוש</span>
            </div>

            {(status?.saved === "1" || status?.updated === "1" || status?.deleted === "1") ? (
              <div className="ok">{status?.saved === "1" ? "התצוגה נשמרה." : status?.updated === "1" ? "התצוגה עודכנה." : "התצוגה נמחקה."}</div>
            ) : null}

            <input className="views-search-input" value={viewSearch} onChange={(event) => setViewSearch(event.target.value)} placeholder="חיפוש תצוגות או תיקיות" />

            <div className="views-folder-list">
              {!groupedSavedViews.length ? <span className="muted">לא נמצאו תצוגות.</span> : groupedSavedViews.map((group) => (
                <details key={group.folderName} className="views-folder-card" open={group.views.some((view) => view.id === currentViewId)}>
                  <summary className="views-folder-head">
                    <strong>{group.folderName}</strong>
                    <span>{group.views.length}</span>
                  </summary>
                  <div className="saved-views-list views-sidebar-saved-list">
                    {group.views.map((view) => (
                      <Link key={view.id} className={`saved-view-chip ${view.id === currentViewId ? "active" : ""}`} href={viewHref(view)}>{view.name}</Link>
                    ))}
                  </div>
                </details>
              ))}
            </div>

            <div className="saved-views-actions views-sidebar-forms">
              <form action={saveStudentViewAction} className="saved-view-form views-sidebar-form">
                <input type="hidden" name="queryString" value={previewQuery || currentQueryString} />
                <input type="hidden" name="returnPath" value={returnPath} />
                <input name="folderName" defaultValue={clean(activeView?.folder_name)} placeholder="תיקיה" />
                <input name="name" defaultValue="" placeholder="שם לתצוגה חדשה" />
                <button type="submit">שמור חדשה</button>
              </form>

              {activeView ? (
                <>
                  <form action={saveStudentViewAction} className="saved-view-form views-sidebar-form">
                    <input type="hidden" name="viewId" value={activeView.id} />
                    <input type="hidden" name="queryString" value={previewQuery || currentQueryString} />
                    <input type="hidden" name="returnPath" value={returnPath} />
                    <input name="folderName" defaultValue={activeView.folder_name || ""} placeholder="תיקיה" />
                    <input name="name" defaultValue={activeView.name} placeholder="שם תצוגה" />
                    <button type="submit">עדכן תצוגה</button>
                  </form>
                  <form action={deleteStudentViewAction} className="views-delete-form">
                    <input type="hidden" name="viewId" value={activeView.id} />
                    <input type="hidden" name="nextQuery" value={previewQuery || currentQueryString} />
                    <input type="hidden" name="returnPath" value={returnPath} />
                    <button type="submit" className="danger-btn">מחק תצוגה</button>
                  </form>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {activePanel === "sort" ? (
          <div className="views-sidebar-block views-panel-surface">
            <div className="views-sidebar-section-head">
              <h3>מיון</h3>
              <button type="button" className="quick-action-btn quick-action-outline" onClick={addSortLevel}>הוסף רמת מיון</button>
            </div>
            <div className="views-sort-stack">
              {state.sortLevels.map((level, index) => (
                <div key={level.id} className="views-sort-card">
                  <div className="views-sort-head">
                    <strong>רמה {index + 1}</strong>
                    <button type="button" className="danger-btn" onClick={() => removeSortLevel(index)}>הסר</button>
                  </div>
                  <SearchableFieldPicker
                    options={sortOptions}
                    value={level.sortBy}
                    onSelect={(nextValue) => updateSortLevel(index, { sortBy: nextValue })}
                    placeholder="חפש שדה למיון"
                    listId={`sort-options-${level.id}`}
                  />
                  <select value={level.sortDir} onChange={(event) => updateSortLevel(index, { sortDir: event.target.value })}>
                    <option value="asc">מהקטן לגדול</option>
                    <option value="desc">מהגדול לקטן</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activePanel === "columns" ? (
          <div className="views-sidebar-block views-panel-surface">
            <div className="views-sidebar-section-head"><h3>עמודות</h3><div className="meta-chip">{state.cols.length}</div></div>
            <input value={fieldSearch} onChange={(event) => setFieldSearch(event.target.value)} placeholder="חיפוש שדות לתצוגה" />
            <div className="builder-columns-grid views-sidebar-columns">
              {visibleColumns.map((option) => {
                const selected = state.cols.includes(option.key);
                return (
                  <button key={option.key} type="button" className={`builder-column-btn ${selected ? "selected" : ""}`} onClick={() => toggleColumn(option.key)}>
                    <span>{option.label}</span>
                    <small>{option.key}</small>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {activePanel === "filters" ? (
          <div className="views-sidebar-block views-panel-surface">
            <div className="views-sidebar-section-head"><h3>קבוצות תנאים</h3><button type="button" className="quick-action-btn quick-action-outline" onClick={addGroup}>הוסף קבוצה</button></div>
            <div className="builder-groups-shell">
              {state.groups.map((group, groupIndex) => (
                <div key={group.id} className="builder-group-wrapper">
                  {groupIndex > 0 ? (
                    <div className="builder-group-operator">
                      <span>חיבור לקבוצה הקודמת</span>
                      <select value={group.groupJoiner} onChange={(event) => updateGroup(groupIndex, { groupJoiner: event.target.value })}>
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                      </select>
                    </div>
                  ) : null}

                  <div className="builder-group-card">
                    <div className="builder-group-head">
                      <div>
                        <h4>קבוצה {groupIndex + 1}</h4>
                        <p className="muted">{group.filters.length} תנאים</p>
                      </div>
                      <div className="builder-group-actions">
                        <button type="button" className="quick-action-btn quick-action-outline" onClick={() => addFilter(groupIndex)}>הוסף תנאי</button>
                        <button type="button" className="danger-btn" onClick={() => removeGroup(groupIndex)}>מחק קבוצה</button>
                      </div>
                    </div>

                    <div className="builder-filter-stack">
                      {group.filters.map((filter, filterIndex) => {
                        const supportsPresetValues = Array.isArray(filterValueOptions?.[filter.field]) && filterValueOptions[filter.field].length > 0;
                        const hidesValue = ["empty", "not_empty"].includes(filter.operator);

                        return (
                          <div key={filter.id} className="builder-filter-row-wrap">
                            {filterIndex > 0 ? (
                              <div className="builder-filter-joiner">
                                <span>בתוך הקבוצה</span>
                                <select value={filter.joiner} onChange={(event) => updateFilter(groupIndex, filterIndex, { joiner: event.target.value })}>
                                  <option value="AND">AND</option>
                                  <option value="OR">OR</option>
                                </select>
                              </div>
                            ) : (
                              <div className="builder-filter-first">תנאי ראשון בקבוצה</div>
                            )}

                            <div className="builder-filter-card">
                              <SearchableFieldPicker
                                options={filterFieldOptions}
                                value={filter.field}
                                onSelect={(nextValue) => updateFilter(groupIndex, filterIndex, { field: nextValue, value: "" })}
                                placeholder="חפש או בחר שדה"
                                listId={`filter-fields-${group.id}-${filterIndex}`}
                              />
                              <select value={filter.operator} onChange={(event) => updateFilter(groupIndex, filterIndex, { operator: event.target.value, value: ["empty", "not_empty"].includes(event.target.value) ? "" : filter.value })}>
                                {Object.entries(filterOperatorOptions).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                              </select>
                              {hidesValue ? (
                                <div className="builder-filter-value-placeholder">ללא ערך</div>
                              ) : supportsPresetValues ? (
                                <select value={filter.value} onChange={(event) => updateFilter(groupIndex, filterIndex, { value: event.target.value })}>
                                  <option value="">בחר ערך</option>
                                  {filterValueOptions[filter.field].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                              ) : (
                                <input value={filter.value} onChange={(event) => updateFilter(groupIndex, filterIndex, { value: event.target.value })} placeholder="ערך לסינון" />
                              )}
                              <button type="button" className="danger-btn" onClick={() => removeFilter(groupIndex, filterIndex)}>הסר</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </aside>

      <section className="views-main views-main-preview-only">
        <div className="card glass views-topbar-card">
          <div>
            <div className="views-sidebar-kicker">Students Preview</div>
            <h2>תצוגת תלמידים</h2>
            <p className="muted">מרכז המסך מציג את התלמידים, בזמן שכל העריכה מרוכזת בטאבים קטנים בצד.</p>
          </div>
          <div className="views-topbar-summary">
            <div className="meta-chip">עמודות: {state.cols.length}</div>
            <div className="meta-chip">תנאים: {flattenedFilters.length}</div>
            <div className="meta-chip">מיון: {state.sortLevels.length}</div>
          </div>
        </div>

        <div className="card builder-preview-card views-editor-card">
          <div className="saved-views-head">
            <div>
              <h3>תלמידים בתצוגה</h3>
              <p className="muted">
                {preview?.previewReady
                  ? `נמצאו ${preview.previewCount} תלמידים. מוצגים כאן עד 30 ראשונים לפי כל רמות המיון והסינון.`
                  : "כדי לראות תלמידים כאן, טען תצוגה שמורה או בחר תנאים ואז לחץ על רענון מקדימה."}
              </p>
            </div>
            <div className="meta-chip">{preview?.previewReady ? `סהכ ${preview.previewCount}` : "ללא מקדימה"}</div>
          </div>

          <div className="views-preview-summary-grid">
            <div className="views-preview-summary-card"><strong>{state.cols.length}</strong><span>עמודות פעילות</span></div>
            <div className="views-preview-summary-card"><strong>{flattenedFilters.length}</strong><span>תנאים פעילים</span></div>
            <div className="views-preview-summary-card"><strong>{state.sortLevels.length}</strong><span>רמות מיון</span></div>
            <div className="views-preview-summary-card views-preview-summary-wide"><strong>{sortSummary}</strong><span>סדר מיון נוכחי</span></div>
          </div>

          <div className="views-preview-tags">
            {visibleColumnLabels.slice(0, 6).map((label) => <span key={label} className="meta-chip">{label}</span>)}
          </div>

          {preview?.previewReady ? (
            <>
              <div className="desktop-table">
                <table>
                  <thead>
                    <tr>
                      {(preview.previewColumns || []).map((column) => <th key={column.key}>{column.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {!preview.previewRows?.length ? (
                      <tr>
                        <td colSpan={Math.max(preview.previewColumns?.length || 1, 1)} className="muted">אין תוצאות לתצוגה הזו</td>
                      </tr>
                    ) : preview.previewRows.map((row) => (
                      <tr key={row.id} style={row.hasMissing ? { background: "#fff1f2" } : undefined}>
                        {(preview.previewColumns || []).map((column) => (
                          <td key={column.key}>
                            {column.key === "name" ? <Link className="student-link" href={`/students/${row.id}`}>{row.values[column.key]}</Link> : row.values[column.key]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mobile-student-list">
                {!preview.previewRows?.length ? (
                  <div className="card muted">אין תוצאות לתצוגה הזו</div>
                ) : preview.previewRows.map((row) => (
                  <div key={row.id} className={`student-mobile-card ${row.hasMissing ? "missing" : ""}`}>
                    <div className="student-mobile-head">
                      <Link className="student-link" href={`/students/${row.id}`}>{row.label}</Link>
                      <span>{row.classLabel}</span>
                    </div>
                    <div className="student-mobile-grid">
                      {(preview.previewColumns || []).map((column) => (
                        <div key={column.key}>
                          <b>{column.label}:</b> {column.key === "name" ? <Link className="student-link" href={`/students/${row.id}`}>{row.values[column.key]}</Link> : row.values[column.key]}
                        </div>
                      ))}
                    </div>
                    {row.hasMissing ? <div className="student-mobile-missing"><b>חוסרים:</b> {row.missingText}</div> : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}


