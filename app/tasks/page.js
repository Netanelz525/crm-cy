import Link from "next/link";
import PendingSubmitButton from "../../components/pending-submit-button";
import { searchNeonStudentsByText } from "../../lib/neon-students";
import { requireAttendanceUser } from "../../lib/rbac";
import {
  listAssignableTaskUsers,
  listTasks,
  taskLinkTypeLabel,
  taskStatusLabel,
  TASK_LINK_TYPES,
  TASK_STATUS_OPTIONS
} from "../../lib/tasks";
import { createTaskAction, deleteTaskAction, updateTaskAction, updateTaskStatusAction } from "./actions";

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

function userOptions(users) {
  return users.map((user) => (
    <option key={user.id} value={user.id}>
      {user.name} {user.email ? `(${user.email})` : ""}
    </option>
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
  const sourceSnapshot = {
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
          <select name="assigneeUserIds" multiple defaultValue={selectedAssignees} size={Math.min(8, Math.max(3, users.length))}>
            {userOptions(users)}
          </select>
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

function TaskCard({ task, users, currentPath }) {
  const assigneeIds = task.assignees?.map((user) => user.id) || [];
  const linkHref = task.linkedType === "student" && task.studentId
    ? `/neon/students/${task.studentId}`
    : task.linkedType === "payment_mandate"
      ? `/payments?reportType=mandates&mandateStatus=all&run=1`
      : "";

  return (
    <details className={`task-card task-card-${task.status}`}>
      <summary className="task-summary">
        <div>
          <div className="task-title">{task.title}</div>
          <div className="task-meta-line">
            <span className="meta-chip">{taskStatusLabel(task.status)}</span>
            <span className="meta-chip">{taskLinkTypeLabel(task.linkedType)}</span>
            <span className="meta-chip">{taskLinkLabel(task)}</span>
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
  const taskCreated = clean(resolvedSearchParams?.taskCreated) === "1";
  const taskUpdated = clean(resolvedSearchParams?.taskUpdated) === "1";
  const taskDeleted = clean(resolvedSearchParams?.taskDeleted) === "1";
  const error = clean(resolvedSearchParams?.error);

  const currentQuery = buildQueryString({ status, assignedTo, linkedType, q, studentQuery });
  const currentPath = currentQuery ? `/tasks?${currentQuery}` : "/tasks";
  const users = await listAssignableTaskUsers();
  const students = studentQuery
    ? await searchNeonStudentsByText(studentQuery, 30, 0.25)
    : clean(resolvedSearchParams?.studentId)
      ? await searchNeonStudentsByText(clean(resolvedSearchParams?.studentName), 30, 0.25)
      : [];
  const tasks = await listTasks({ status, assignedTo, linkedType, q, limit: 250 });

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
      {taskUpdated ? <div className="ok">המשימה עודכנה.</div> : null}
      {taskDeleted ? <div className="ok">המשימה נמחקה.</div> : null}
      {error ? <div className="error">{error}</div> : null}

      <section className="card">
        <details open={Boolean(clean(resolvedSearchParams?.studentId) || clean(resolvedSearchParams?.paymentMandateId))}>
          <summary className="tasks-section-summary">יצירת משימה חדשה</summary>
          <form className="task-search-form" action="/tasks">
            <input name="studentQuery" defaultValue={studentQuery} placeholder="חיפוש תלמיד לפי שם / טלפון / ת״ז" />
            <button className="quick-action-btn quick-action-outline" type="submit">חפש תלמיד</button>
          </form>
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
              <TaskCard key={task.id} task={task} users={users} currentPath={currentPath} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
