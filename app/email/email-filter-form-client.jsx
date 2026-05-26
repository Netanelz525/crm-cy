"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function CheckboxGroup({ legend, name, options, values, onToggle }) {
  return (
    <fieldset className="email-filter-fieldset">
      <legend>{legend}</legend>
      <div className="email-checkbox-grid">
        {options.map((option) => (
          <label key={`${name}-${option.value}`} className="email-checkbox-option">
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              onChange={() => onToggle(name, option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function EmailFilterFormClient({
  draftId,
  filters,
  hasActiveFilterValues,
  activeFilterSummary,
  institutionOptions,
  classOptions,
  registrationOptions,
  familystatusOptions,
  availableTags
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState(filters.q || "");
  const [formState, setFormState] = useState({
    institution: unique(filters.institution),
    class: unique(filters.class),
    registration: unique(filters.registration),
    familystatus: unique(filters.familystatus),
    tagIds: unique(filters.tagIds),
    recipientRoles: unique(filters.recipientRoles)
  });

  useEffect(() => {
    setQuery(filters.q || "");
  }, [filters.q]);

  useEffect(() => {
    setFormState({
      institution: unique(filters.institution),
      class: unique(filters.class),
      registration: unique(filters.registration),
      familystatus: unique(filters.familystatus),
      tagIds: unique(filters.tagIds),
      recipientRoles: unique(filters.recipientRoles)
    });
  }, [filters.class, filters.familystatus, filters.institution, filters.recipientRoles, filters.registration, filters.tagIds]);

  function buildHref(nextState) {
    const params = new URLSearchParams();
    params.set("compose", "1");
    if (draftId) params.set("draft", draftId);
    nextState.institution.forEach((value) => params.append("institution", value));
    nextState.class.forEach((value) => params.append("class", value));
    nextState.registration.forEach((value) => params.append("registration", value));
    nextState.familystatus.forEach((value) => params.append("familystatus", value));
    nextState.tagIds.forEach((value) => params.append("tagIds", value));
    nextState.recipientRoles.forEach((value) => params.append("recipientRoles", value));
    params.set("q", nextState.q || "");
    return `${pathname}?${params.toString()}`;
  }

  function navigate(nextState) {
    startTransition(() => {
      router.replace(buildHref(nextState), { scroll: false });
    });
  }

  useEffect(() => {
    if (query === (filters.q || "")) return undefined;
    const timeoutId = window.setTimeout(() => {
      navigate({ ...formState, q: query });
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [filters.q, formState, query]);

  function toggleValue(field, value) {
    const current = new Set(formState[field] || []);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    const nextState = { ...formState, [field]: Array.from(current), q: query };
    setFormState((prev) => ({ ...prev, [field]: nextState[field] }));
    navigate(nextState);
  }

  function clearField(field) {
    const nextState = { ...formState, [field]: field === "recipientRoles" ? ["father", "mother"] : [], q: "" };
    if (field !== "q") nextState.q = query;
    setFormState((prev) => ({ ...prev, [field]: field === "recipientRoles" ? ["father", "mother"] : [] }));
    if (field === "q") setQuery("");
    navigate(nextState);
  }

  function clearAll() {
    const nextState = {
      institution: [],
      class: [],
      registration: [],
      familystatus: [],
      tagIds: [],
      recipientRoles: ["father", "mother"],
      q: ""
    };
    setFormState(nextState);
    setQuery("");
    navigate(nextState);
  }

  return (
    <details className="email-filter-card" open={isOpen}>
      <summary onClick={(event) => {
        event.preventDefault();
        setIsOpen((current) => !current);
      }}>
        <div className="email-filter-summary">
          <span className="email-filter-summary-title">סינון נמענים</span>
          <span className="email-filter-summary-hint">לחץ כאן לפתיחה ושינוי של אפשרויות הסינון</span>
          {activeFilterSummary.length ? (
            <div className="email-filter-tags" aria-label="סינונים פעילים">
              {activeFilterSummary.map((item) => (
                <span key={`${item.label}-${item.value}`} className="email-filter-pill">
                  <b>{item.label}</b>
                  <span>{item.value}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {hasActiveFilterValues ? (
          <button
            type="button"
            className="email-clear-link email-clear-button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              clearAll();
            }}
            disabled={isPending}
          >
            נקה הכול
          </button>
        ) : null}
      </summary>
      <div aria-busy={isPending}>
        <div className="email-form-grid">
          <CheckboxGroup legend="מוסד" name="institution" options={institutionOptions} values={formState.institution} onToggle={toggleValue} />
          <CheckboxGroup legend="שיעור" name="class" options={classOptions} values={formState.class} onToggle={toggleValue} />
          <CheckboxGroup legend="רישום" name="registration" options={registrationOptions} values={formState.registration} onToggle={toggleValue} />
          <CheckboxGroup legend="מצב משפחתי" name="familystatus" options={familystatusOptions} values={formState.familystatus} onToggle={toggleValue} />
          <CheckboxGroup
            legend="תוויות"
            name="tagIds"
            options={availableTags.map((tag) => ({ value: tag.id, label: tag.name }))}
            values={formState.tagIds}
            onToggle={toggleValue}
          />
          <CheckboxGroup
            legend="למי לשלוח"
            name="recipientRoles"
            options={[
              { value: "father", label: "אבא" },
              { value: "mother", label: "אמא" },
              { value: "student", label: "תלמיד" }
            ]}
            values={formState.recipientRoles}
            onToggle={toggleValue}
          />
          <div className="email-filter-field">
            <span className="email-field-header">
              <label htmlFor="email-filter-q">חיפוש תלמיד</label>
              {query ? (
                <button type="button" className="email-clear-link email-clear-button" onClick={() => clearField("q")} disabled={isPending}>
                  נקה בחירה
                </button>
              ) : null}
            </span>
            <input
              id="email-filter-q"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="שם, מייל או טלפון"
            />
          </div>
        </div>
      </div>
    </details>
  );
}
