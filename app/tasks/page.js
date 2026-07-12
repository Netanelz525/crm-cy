import Link from "next/link";
import PendingSubmitButton from "../../components/pending-submit-button";
import { searchNeonStudentsByText, searchNeonStudentsByTz } from "../../lib/neon-students";
import { requireAttendanceUser } from "../../lib/rbac";
import {
  listAssignableTaskUsers,
  listTasks,
  taskLinkTypeLabel,
  taskStatusLabel,
  TASK_LINK_TYPES,
  TASK_STATUS_OPTIONS
} from "../../lib/tasks";
import { createTaskAction, deleteTaskAction, refreshTaskPaymentMandateAction, updateTaskAction, updateTaskStatusAction } from "./actions";

function clean(value) {
  return String(value || "").trim();
}

function buildQueryString(values = {}) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    const next = clean(value);
    if (next) params.set(key, next);
  });
  return params.toString();
}

function taskLinkLabel(task) {
  if (task.linkedType === "student") {
    return task.studentName || task.studentId || "תלמיד";
  }
  return [
    task.paymentCustomerName || "הוראת קבע",
    task.paymentMandateId ? `מס׳ ${task.paymentMandateId}` : "",
    task.paymentConnectionLabel
  ].filter(Boolean).join(" | ");
}

function assigneeNames(task) {
  if (!task.assignees?.length) return "לא שובץ אחראי";
  return task.assignees.map((user) => user.name || user.email).filter(Boolean).join(", ");
}

function normalizeDigits(value) {
  return clean(value).replace(/[^\d]/g, "");
}

function normalizePhoneForHref(value) {
  const digits = normalizeDigits(value);
  if (!digits) return "";
  if (digits.startsWith("972")) return digits;
  if (digits.startsWith("0")) return `972${digits.slice(1)}`;
  return digits;
}

function contactOptionsForTask(task) {
  const snapshot = task.sourceSnapshot || {};
  const mandate = snapshot.paymentMandateAtCreation || snapshot;
  if (task.linkedType === "payment_mandate") {
    return {
      emails: [
        { label: "מייל תורם", value: mandate.email || task.paymentCustomerEmail }
      ],
      phones: [
        { label: "טלפון תורם", value: mandate.phone }
      ]
    };
  }
  return {
    emails: [
      { label: "מייל תלמיד", value: task.studentEmail },
      { label: "מייל אב", value: task.studentFatherEmail },
      { label: "מייל אם", value: task.studentMotherEmail }
    ],
    phones: [
      { label: "טלפון תלמיד", value: task.studentPhone },
      { label: "טלפון אב", value: task.studentFatherPhone },
      { label: "טלפון אם", value: task.studentMotherPhone }
    ]
  };
}

function TaskContactActions({ task, linkHref }) {
  const contacts = contactOptionsForTask(task);
  const emails = contacts.emails
    .map((item) => ({ ...item, value: clean(item.value).toLowerCase() }))
    .filter((item) => item.value && item.value.includes("@"));
  const phones = contacts.phones
    .map((item) => ({ ...item, value: normalizePhoneForHref(item.value) }))
    .filter((item) => item.value);
  const hasActions = Boolean(linkHref || emails.length || phones.length);
  if (!hasActions) return null;

  return (
    <div className="task-contact-actions">
      <b>פעולות קשר</b>
      <div className="task-contact-buttons">
        {linkHref && task.linkedType === "student" ? (
          <Link className="quick-action-btn quick-action-outline" href={linkHref}>פתח כרטיס תלמיד</Link>
        ) : null}
        {emails.map((item) => (
          <a key={`email-${item.label}-${item.value}`} className="quick-action-btn quick-action-outline" href={`mailto:${item.value}`}>
            {item.label}
          </a>
        ))}
        {phones.map((item) => (
          <a key={`call-${item.label}-${item.value}`} className="quick-action-btn quick-action-outline" href={`tel:+${item.value}`}>
            חיוג {item.label.replace("טלפון ", "")}
          </a>
        ))}
        {phones.map((item) => (
          <a key={`whatsapp-${item.label}-${item.value}`} className="quick-action-btn quick-action-outline" href={`https://wa.me/${item.value}`} target="_blank" rel="noreferrer">
            WhatsApp {item.label.replace("טלפון ", "")}
          </a>
        ))}
      </div>
    </div>
  );
}

function TaskSummaryContactMarkers({ task, linkHref }) {
  const contacts = contactOptionsForTask(task);
  const email = contacts.emails
    .map((item) => clean(item.value).toLowerCase())
    .find((value) => value && value.includes("@"));
  const phone = contacts.phones
    .map((item) => normalizePhoneForHref(item.value))
    .find(Boolean);

  if (!email && !phone && !(linkHref && task.linkedType === "student")) return null;

  return (
    <span className="task-summary-contact-markers" aria-label="פעולות מהירות">
      {linkHref && task.linkedType === "student" ? (
        <Link className="task-summary-marker" href={linkHref} title="כרטיס תלמיד">כרטיס</Link>
      ) : null}
      {email ? (
        <a className="task-summary-marker" href={`mailto:${email}`} title="שליחת מייל">@</a>
      ) : null}
      {phone ? (
        <a className="task-summary-marker" href={`tel:+${phone}`} title="חיוג">טל׳</a>
      ) : null}
      {phone ? (
        <a className="task-summary-marker" href={`https://wa.me/${phone}`} target="_blank" rel="noreferrer" title="WhatsApp">WA</a>
      ) : null}
    </span>
  );
}

function mergeStudents(...groups) {
  const seen = new Set();
  const merged = [];
  for (const group of groups) {
    for (const student of group || []) {
      const id = clean(student?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(student);
    }
  }
  return merged;
}

function parseSnapshotParam(value) {
  const raw = clean(value);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function userCheckboxes(users, selectedAssignees = []) {
  const selectedSet = new Set((selectedAssignees || []).map(clean).filter(Boolean));
  return users.map((user) => (
    <label key={user.id} className="task-assignee-option">
      <input type="checkbox" name="assigneeUserIds" value={user.id} defaultChecked={selectedSet.has(user.id)} />
      <span>
        <b>{user.name}</b>
        {user.email ? <small>{user.email}</small> : null}
      </span>
    </label>
  ));
}

function statusOptions(selectedStatus = "pending") {
  return TASK_STATUS_OPTIONS.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));
}

function TaskForm({
  users,
  students,
  currentUser,
  searchParams,
  currentPath,
  editingTask = null
}) {
  const fromStudentId = clean(searchParams?.studentId || editingTask?.studentId);
  const linkedType = clean(searchParams?.linkedType || editingTask?.linkedType) || (clean(searchParams?.paymentMandateId) ? "payment_mandate" : "student");
  const selectedAssignees = editingTask?.assignees?.map((user) => user.id) || [currentUser.clerk_user_id];
  const defaultTitle = clean(searchParams?.title || editingTask?.title) || (linkedType === "payment_mandate" ? "טיפול בהוראת קבע בעייתית" : "");
  const incomingSnapshot = parseSnapshotParam(searchParams?.sourceSnapshot);
  const sourceSnapshot = {
    ...incomingSnapshot,
    mandateId: clean(searchParams?.paymentMandateId),
    provider: clean(searchParams?.paymentProvider),
    connectionId: clean(searchParams?.paymentConnectionId),
    connectionLabel: clean(searchParams?.paymentConnectionLabel),
    customerName: clean(searchParams?.paymentCustomerName),
    customerEmail: clean(searchParams?.paymentCustomerEmail)
  };

  return (
    <form action={editingTask ? updateTaskAction : createTaskAction} className="task-form">
      <input type="hidden" name="returnTo" value={currentPath} />
      {editingTask ? <input type="hidden" name="taskId" value={editingTask.id} /> : null}
      <input type="hidden" name="sourceSnapshot" value={JSON.stringify(editingTask?.sourceSnapshot || sourceSnapshot)} />
      <div className="grid">
        <label>
          כותרת
          <input name="title" defaultValue={defaultTitle} placeholder="לדוגמה: לבדוק הוראת קבע מול התורם" required />
        </label>
        <label>
          סטטוס
          <select name="status" defaultValue={editingTask?.status || "pending"}>
            {statusOptions(editingTask?.status || "pending")}
          </select>
        </label>
        <label>
          סוג קישור
          <select name="linkedType" defaultValue={linkedType} disabled={Boolean(editingTask)}>
            {TASK_LINK_TYPES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          {editingTask ? <input type="hidden" name="linkedType" value={editingTask.linkedType} /> : null}
        </label>
        <label>
          תלמיד
          <select name="studentId" defaultValue={fromStudentId} disabled={Boolean(editingTask)}>
            <option value="">בחר תלמיד</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.label || student.name} {student.tznum ? `- ${student.tznum}` : ""}
              </option>
            ))}
          </select>
          {editingTask ? <input type="hidden" name="studentId" value={editingTask.studentId} /> : null}
        </label>
        <label>
          מספר הוראת קבע
          <input name="paymentMandateId" defaultValue={clean(searchParams?.paymentMandateId || editingTask?.paymentMandateId)} disabled={Boolean(editingTask)} />
          {editingTask ? <input type="hidden" name="paymentMandateId" value={editingTask.paymentMandateId} /> : null}
        </label>
        <label>
          שם תורם
          <input name="paymentCustomerName" defaultValue={clean(searchParams?.paymentCustomerName || editingTask?.paymentCustomerName)} disabled={Boolean(editingTask)} />
          {editingTask ? <input type="hidden" name="paymentCustomerName" value={editingTask.paymentCustomerName} /> : null}
        </label>
        <label>
          מייל תורם
          <input name="paymentCustomerEmail" defaultValue={clean(searchParams?.paymentCustomerEmail || editingTask?.paymentCustomerEmail)} disabled={Boolean(editingTask)} />
          {editingTask ? <input type="hidden" name="paymentCustomerEmail" value={editingTask.paymentCustomerEmail} /> : null}
        </label>
        <label>
          מקור תשלום
          <input name="paymentConnectionLabel" defaultValue={clean(searchParams?.paymentConnectionLabel || editingTask?.paymentConnectionLabel)} disabled={Boolean(editingTask)} />
          {editingTask ? <input type="hidden" name="paymentConnectionLabel" value={editingTask.paymentConnectionLabel} /> : null}
        </label>
        <input type="hidden" name="paymentProvider" value={clean(searchParams?.paymentProvider || editingTask?.paymentProvider)} />
        <input type="hidden" name="paymentConnectionId" value={clean(searchParams?.paymentConnectionId || editingTask?.paymentConnectionId)} />
        <label className="tasks-wide">
          אנשי צוות אחראים
          <div className="task-assignee-grid">
            {userCheckboxes(users, selectedAssignees)}
          </div>
        </label>
        <label className="tasks-wide">
          הערות והסבר
          <textarea name="description" rows={5} defaultValue={editingTask?.description || ""} placeholder="מה צריך לבדוק, מול מי, ומה הצעד הבא?" />
        </label>
      </div>
      <div className="quick-actions">
        <PendingSubmitButton className="quick-action-btn quick-action-primary" pendingText={editingTask ? "שומר..." : "יוצר משימה..."}>
          {editingTask ? "שמור משימה" : "צור משימה"}
        </PendingSubmitButton>
        {editingTask ? <Link className="quick-action-btn quick-action-outline" href="/tasks">בטל עריכה</Link> : null}
      </div>
    </form>
  );
}

function formatValue(value) {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw) && !Number.isNaN(date.getTime())) {
    return date.toLocaleDateString("he-IL");
  }
  return raw;
}

function formatMoneyValue(amount, currency = "ILS") {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return "-";
  try {
    return new Intl.NumberFormat("he-IL", { style: "currency", currency: clean(currency) || "ILS" }).format(numeric);
  } catch {
    return `${numeric.toFixed(2)} ${clean(currency) || "ILS"}`;
  }
}

function MandateSnapshotPanel({ task, currentPath }) {
  if (task.linkedType !== "payment_mandate") return null;
  const snapshot = task.sourceSnapshot || {};
  const created = snapshot.paymentMandateAtCreation || snapshot;
  const latest = snapshot.latestPaymentMandateSnapshot || null;
  const changed = snapshot.latestPaymentMandateChanged;
  const checkedAt = snapshot.latestPaymentMandateCheckedAt;
  const rows = [
    ["שם תורם", created.customerName || task.paymentCustomerName],
    ["מייל", created.email || task.paymentCustomerEmail],
    ["מספר הו״ק", created.mandateId || task.paymentMandateId],
    ["מקור סליקה", created.connectionLabel || task.paymentConnectionLabel],
    ["סטטוס בזמן יצירה", created.statusLabel || created.status],
    ["סיבת תקלה בזמן יצירה", created.errorText || created.issueKind],
    ["סכום", formatMoneyValue(created.amountIls ?? created.amount ?? created.originalAmount, "ILS")],
    ["חיוב הבא", created.nextChargeDate],
    ["4 ספרות", created.paymentMethodLast4],
    ["תוקף", created.paymentMethodExpiry]
  ];

  return (
    <div className="task-mandate-panel">
      <div className="summary-row">
        <div>
          <b>פרטי הוראת הקבע בזמן יצירת המשימה</b>
          <div className="muted">הנתונים נשמרים על המשימה כדי שאפשר יהיה להשוות מול הסליקה בהמשך.</div>
        </div>
        <form action={refreshTaskPaymentMandateAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={currentPath} />
          <button className="quick-action-btn quick-action-outline" type="submit">בדוק מול הסליקה</button>
        </form>
      </div>
      <div className="tasks-info-grid">
        {rows.map(([label, value]) => (
          <div key={label}><b>{label}:</b> {formatValue(value)}</div>
        ))}
      </div>
      {latest ? (
        <div className={changed ? "error" : "ok"} style={{ marginBottom: 0 }}>
          {changed ? "נמצא שינוי מול הנתונים שנשמרו בזמן יצירת המשימה." : "לא נמצא שינוי מהותי מול הנתונים שנשמרו בזמן יצירת המשימה."}
          {checkedAt ? ` נבדק: ${new Date(checkedAt).toLocaleString("he-IL")}` : ""}
        </div>
      ) : null}
    </div>
  );
}

function TaskCard({ task, users, currentPath, activeTaskId = "" }) {
  const assigneeIds = task.assignees?.map((user) => user.id) || [];
  const linkHref = task.linkedType === "student" && task.studentId
    ? `/neon/students/${task.studentId}`
    : task.linkedType === "payment_mandate"
      ? `/payments?reportType=mandates&mandateStatus=all&run=1`
      : "";

  return (
    <details className={`task-card task-card-${task.status}`} open={clean(activeTaskId) === clean(task.id)}>
      <summary className="task-summary">
        <div>
          <div className="task-title">{task.title}</div>
          <div className="task-meta-line">
            <span className="meta-chip">{taskStatusLabel(task.status)}</span>
            <span className="meta-chip">{taskLinkTypeLabel(task.linkedType)}</span>
            <span className="meta-chip">{taskLinkLabel(task)}</span>
            <TaskSummaryContactMarkers task={task} linkHref={linkHref} />
          </div>
        </div>
        <div className="task-assignees">{assigneeNames(task)}</div>
      </summary>
      <div className="task-body">
        <div className="tasks-info-grid">
          <div><b>קישור:</b> {linkHref ? <Link href={linkHref}>{taskLinkLabel(task)}</Link> : taskLinkLabel(task)}</div>
          <div><b>עודכן:</b> {task.updatedAt ? new Date(task.updatedAt).toLocaleString("he-IL") : "-"}</div>
          <div><b>נוצר על ידי:</b> {task.createdByName || "-"}</div>
          <div><b>אחראים:</b> {assigneeNames(task)}</div>
          <div className="tasks-wide"><b>הערות:</b> {task.description || "-"}</div>
        </div>
        <TaskContactActions task={task} linkHref={linkHref} />
        <MandateSnapshotPanel task={task} currentPath={currentPath} />

        <form action={updateTaskStatusAction} className="task-status-form">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={currentPath} />
          <select name="status" defaultValue={task.status}>
            {statusOptions(task.status)}
          </select>
          <button type="submit">עדכן סטטוס</button>
        </form>

        <details className="task-inline-edit">
          <summary className="quick-action-btn quick-action-outline">עריכת משימה</summary>
          <TaskForm
            users={users}
            students={task.studentId ? [{ id: task.studentId, label: task.studentName || task.studentId, tznum: "" }] : []}
            currentUser={{ clerk_user_id: "" }}
            searchParams={{}}
            currentPath={currentPath}
            editingTask={{ ...task, assignees: task.assignees?.length ? task.assignees : assigneeIds.map((id) => ({ id })) }}
          />
        </details>

        <form action={deleteTaskAction}>
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="returnTo" value={currentPath} />
          <button className="btn btn-danger" type="submit">מחק משימה</button>
        </form>
      </div>
    </details>
  );
}

export default async function TasksPage({ searchParams }) {
  const currentUser = await requireAttendanceUser();
  const resolvedSearchParams = await searchParams;
  const status = clean(resolvedSearchParams?.status);
  const assignedTo = clean(resolvedSearchParams?.assignedTo);
  const linkedType = clean(resolvedSearchParams?.linkedType);
  const q = clean(resolvedSearchParams?.q);
  const studentQuery = clean(resolvedSearchParams?.studentQuery || resolvedSearchParams?.studentName);
  const taskId = clean(resolvedSearchParams?.taskId);
  const taskCreated = clean(resolvedSearchParams?.taskCreated) === "1";
  const taskUpdated = clean(resolvedSearchParams?.taskUpdated) === "1";
  const taskDeleted = clean(resolvedSearchParams?.taskDeleted) === "1";
  const taskMailWarning = clean(resolvedSearchParams?.taskMailWarning);
  const taskRefreshed = clean(resolvedSearchParams?.taskRefreshed);
  const taskRefreshError = clean(resolvedSearchParams?.taskRefreshError);
  const error = clean(resolvedSearchParams?.error);

  const currentQuery = buildQueryString({ taskId, status, assignedTo, linkedType, q, studentQuery });
  const currentPath = currentQuery ? `/tasks?${currentQuery}` : "/tasks";
  const users = await listAssignableTaskUsers();
  const studentQueryDigits = normalizeDigits(studentQuery);
  const students = studentQuery
    ? mergeStudents(
      await searchNeonStudentsByText(studentQuery, 30, 0.25),
      studentQueryDigits ? await searchNeonStudentsByTz(studentQueryDigits) : []
    ).slice(0, 30)
    : clean(resolvedSearchParams?.studentId)
      ? await searchNeonStudentsByText(clean(resolvedSearchParams?.studentName), 30, 0.25)
      : [];
  const tasks = await listTasks({ taskId, status, assignedTo, linkedType, q, limit: 250 });

  if (clean(resolvedSearchParams?.studentId) && !students.some((student) => student.id === clean(resolvedSearchParams.studentId))) {
    students.unshift({
      id: clean(resolvedSearchParams.studentId),
      label: clean(resolvedSearchParams.studentName) || clean(resolvedSearchParams.studentId),
      tznum: ""
    });
  }

  return (
    <div className="tasks-page">
      <section className="card glass">
        <div className="summary-row">
          <div>
            <h1 style={{ marginTop: 0 }}>משימות</h1>
            <p className="muted" style={{ marginBottom: 0 }}>
              משימות טיפול המקושרות לתלמידים או להוראות קבע בעייתיות, עם אחראים וסטטוס טיפול.
            </p>
          </div>
          <Link className="quick-action-btn quick-action-outline" href="/neon">חזרה לתלמידים</Link>
        </div>
      </section>

      {taskCreated ? <div className="ok">המשימה נוצרה בהצלחה.</div> : null}
      {taskMailWarning ? <div className="error">המשימה נוצרה, אבל היתה בעיה בשליחת המייל לאחראים: {taskMailWarning}</div> : null}
      {taskUpdated ? <div className="ok">המשימה עודכנה.</div> : null}
      {taskDeleted ? <div className="ok">המשימה נמחקה.</div> : null}
      {taskRefreshed === "changed" ? <div className="error">הבדיקה מול הסליקה הסתיימה ונמצא שינוי.</div> : null}
      {taskRefreshed === "same" ? <div className="ok">הבדיקה מול הסליקה הסתיימה ולא נמצא שינוי מהותי.</div> : null}
      {taskRefreshError ? <div className="error">{taskRefreshError}</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card">
        <details open={Boolean(clean(resolvedSearchParams?.studentId) || clean(resolvedSearchParams?.paymentMandateId) || studentQuery)}>
          <summary className="tasks-section-summary">יצירת משימה חדשה</summary>
          <form className="task-search-form" action="/tasks">
            <input type="hidden" name="linkedType" value="student" />
            {clean(resolvedSearchParams?.title) ? <input type="hidden" name="title" value={clean(resolvedSearchParams.title)} /> : null}
            {clean(resolvedSearchParams?.sourceSnapshot) ? <input type="hidden" name="sourceSnapshot" value={clean(resolvedSearchParams.sourceSnapshot)} /> : null}
            <input name="studentQuery" defaultValue={studentQuery} placeholder="חיפוש תלמיד לפי שם / טלפון / ת״ז" />
            <button className="quick-action-btn quick-action-outline" type="submit">חפש תלמיד</button>
          </form>
          {studentQuery ? (
            <div className={students.length ? "ok" : "error"}>
              {students.length
                ? `נמצאו ${students.length} תלמידים. בחר תלמיד מהרשימה בשדה "תלמיד".`
                : "לא נמצאו תלמידים לחיפוש הזה."}
            </div>
          ) : null}
          <TaskForm
            users={users}
            students={students}
            currentUser={currentUser}
            searchParams={resolvedSearchParams}
            currentPath="/tasks"
          />
        </details>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>סינון משימות</h2>
        <form className="grid" action="/tasks">
          <label>
            חיפוש
            <input name="q" defaultValue={q} placeholder="כותרת, תלמיד, תורם או מספר הוראת קבע" />
          </label>
          <label>
            סטטוס
            <select name="status" defaultValue={status}>
              <option value="">כל הסטטוסים</option>
              {TASK_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            אחראי
            <select name="assignedTo" defaultValue={assignedTo}>
              <option value="">כל האחראים</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </label>
          <label>
            סוג קישור
            <select name="linkedType" defaultValue={linkedType}>
              <option value="">כל הסוגים</option>
              {TASK_LINK_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="quick-actions">
            <button type="submit">סנן</button>
            <Link className="quick-action-btn quick-action-outline" href="/tasks">נקה סינון</Link>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>רשימת משימות</h2>
        {!tasks.length ? (
          <div className="muted">אין משימות להצגה בסינון הנוכחי.</div>
        ) : (
          <div className="tasks-list">
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} users={users} currentPath={currentPath} activeTaskId={taskId} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
