import { NextResponse } from "next/server";
import { getCurrentAppUser } from "../../../../lib/rbac";
import { getStudentsByInstitution } from "../../../../lib/twenty";

const CLASS_LABELS = {
  Z: "אברך",
  A: "שיעור א",
  B: "שיעור ב",
  C: "שיעור ג",
  D: "שיעור ד",
  E: "שיעור ה",
  X: "קיבוץ",
  TEAM: "צוות"
};

const CLASS_ORDER = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  X: 6,
  Z: 7,
  TEAM: 8
};

const COLUMN_DEFS = {
  name: "שם",
  class: "שיעור",
  tznum: "ת\"ז",
  age: "גיל",
  studentPhone: "טלפון תלמיד",
  dadPhone: "טלפון אב",
  momPhone: "טלפון אם",
  studentEmail: "אימייל תלמיד",
  fatherEmail: "אימייל אב",
  motherEmail: "אימייל אם",
  institution: "מוסד",
  registration: "רישום",
  macAddress: "macAddress",
  missing: "חוסרים"
};

const DEFAULT_COLS = ["name", "class", "tznum", "age", "studentPhone", "dadPhone", "momPhone", "missing"];

function clean(v) {
  return String(v || "").trim();
}

function hasPhone(obj) {
  return Boolean(clean(obj?.primaryPhoneNumber));
}

function hasEmail(obj) {
  return Boolean(clean(obj?.primaryEmail));
}

function hasCompleteParentContact(student) {
  const dadComplete = hasPhone(student?.dadPhone) && hasEmail(student?.fatherEmail);
  const momComplete = hasPhone(student?.momPhone) && hasEmail(student?.motherEmail);
  return dadComplete || momComplete;
}

function buildMissingState(student) {
  const hasContactMissing = !hasCompleteParentContact(student);
  const hasIdentityMissing = !clean(student?.tznum) || !clean(student?.dateofbirth);
  const items = [];
  if (hasContactMissing) items.push("חסר הורה עם טלפון+אימייל");
  if (hasIdentityMissing) items.push("חסר ת\"ז או תאריך לידה");
  return {
    items,
    flags: {
      contact: hasContactMissing,
      identity: hasIdentityMissing
    }
  };
}

function matchesMissingFilter(missingState, missingType) {
  if (!missingType) return true;
  return Boolean(missingState?.flags?.[missingType]);
}

function phoneText(phoneObj) {
  if (!phoneObj?.primaryPhoneNumber) return "-";
  return [clean(phoneObj.primaryPhoneCallingCode), clean(phoneObj.primaryPhoneNumber)].filter(Boolean).join(" ");
}

function ageOf(dateValue) {
  if (!dateValue) return null;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  const day = now.getDate() - d.getDate();
  if (m < 0 || (m === 0 && day < 0)) age -= 1;
  return age >= 0 ? age : null;
}

function classLabel(value) {
  const key = clean(value).toUpperCase();
  return CLASS_LABELS[key] || clean(value) || "-";
}

function getLastName(student) {
  const fromFullName = clean(student?.fullName?.lastName);
  if (fromFullName) return fromFullName;
  const label = clean(student?.label);
  if (!label) return "";
  const parts = label.split(/\s+/).filter(Boolean);
  return clean(parts[parts.length - 1]);
}

function compareInstitutionStudents(a, b) {
  const aClass = clean(a.class).toUpperCase();
  const bClass = clean(b.class).toUpperCase();
  const aRank = CLASS_ORDER[aClass] ?? 999;
  const bRank = CLASS_ORDER[bClass] ?? 999;
  if (aRank !== bRank) return aRank - bRank;

  const lastCmp = getLastName(a).localeCompare(getLastName(b), "he", { sensitivity: "base" });
  if (lastCmp !== 0) return lastCmp;
  return clean(a.label).localeCompare(clean(b.label), "he", { sensitivity: "base" });
}

function valueByColumn(student, key) {
  switch (key) {
    case "name":
      return clean(student?.label) || "-";
    case "class":
      return classLabel(student?.class);
    case "tznum":
      return clean(student?.tznum) || "-";
    case "age":
      return String(ageOf(student?.dateofbirth) ?? "-");
    case "studentPhone":
      return phoneText(student?.phone);
    case "dadPhone":
      return phoneText(student?.dadPhone);
    case "momPhone":
      return phoneText(student?.momPhone);
    case "studentEmail":
      return clean(student?.email?.primaryEmail) || "-";
    case "fatherEmail":
      return clean(student?.fatherEmail?.primaryEmail) || "-";
    case "motherEmail":
      return clean(student?.motherEmail?.primaryEmail) || "-";
    case "institution":
      return clean(student?.currentInstitution) || "-";
    case "registration":
      return clean(student?.registration) || "-";
    case "macAddress":
      return clean(student?.macAddress) || "-";
    case "missing":
      return (student?.missingItems || []).length ? student.missingItems.join(", ") : "-";
    default:
      return "-";
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function GET(request) {
  const user = await getCurrentAppUser();
  if (!user || (!user.is_team_member && !user.is_manager)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const url = new URL(request.url);
  const institution = clean(url.searchParams.get("institution"));
  const institutionSearch = clean(url.searchParams.get("institutionSearch"));
  const missingOnly = clean(url.searchParams.get("missingOnly")) === "1";
  const missingTypeParam = clean(url.searchParams.get("missingType")).toLowerCase();
  const missingType = ["contact", "identity"].includes(missingTypeParam)
    ? missingTypeParam
    : (missingOnly ? "contact" : "");

  if (!institution) {
    return NextResponse.json({ error: "Missing institution" }, { status: 400 });
  }

  const requestedCols = url.searchParams.getAll("cols").map(clean).filter(Boolean);
  const selectedCols = (requestedCols.length ? requestedCols : DEFAULT_COLS).filter((k) => COLUMN_DEFS[k]);

  let students = await getStudentsByInstitution(institution);
  if (institutionSearch) {
    const s = institutionSearch.toLowerCase();
    students = students.filter((x) => clean(x.label).toLowerCase().includes(s));
  }

  students = students.map((s) => {
    const missingState = buildMissingState(s);
    return { ...s, missingItems: missingState.items, missingFlags: missingState.flags };
  });
  if (missingType) {
    students = students.filter((s) => matchesMissingFilter({ flags: s.missingFlags }, missingType));
  }

  students.sort(compareInstitutionStudents);

  const header = selectedCols.map((c) => COLUMN_DEFS[c]);
  const rows = students.map((student) => selectedCols.map((c) => valueByColumn(student, c)));

  const csv = [
    header.map(csvEscape).join(","),
    ...rows.map((r) => r.map(csvEscape).join(","))
  ].join("\n");

  const bom = "\uFEFF";
  const filename = `students-${institution}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(bom + csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`
    }
  });
}







