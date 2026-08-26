import Link from "next/link";
import { redirect } from "next/navigation";
import { getDefaultPaymentDateRange, listPaymentConnections } from "../../../lib/payment-systems";
import { listAllNeonStudents } from "../../../lib/neon-students";
import { listPaymentContactRecommendations, listPaymentRecordLinks } from "../../../lib/payment-links";
import { getCurrentAppUser, listAppUsers } from "../../../lib/rbac";
import { listCallAssignments } from "../../../lib/student-call-assignments";
import PaymentLinkingClient from "./payment-linking-client";

function clean(value) { return String(value || "").trim(); }
export default async function PaymentLinkingPage({ searchParams }) {
  const user = await getCurrentAppUser();
  if (!user) redirect("/sign-in?redirect_url=/payments/linking");
  if (!user.is_team_member && !user.is_manager && !user.is_super_admin) redirect("/unauthorized");

  const params = await searchParams;
  const defaults = getDefaultPaymentDateRange();
  const dateFrom = clean(params?.dateFrom) || defaults.dateFrom;
  const dateTo = clean(params?.dateTo) || defaults.dateTo;
  const connections = await listPaymentConnections({ activeOnly: true });
  const [students, links, contactRecommendations, users, callAssignments] = await Promise.all([listAllNeonStudents(), listPaymentRecordLinks(), listPaymentContactRecommendations(), listAppUsers(), listCallAssignments()]);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="card glass">
        <h1 style={{ marginTop: 0 }}>שיוך תשלומים לתלמידים</h1>
        <p className="muted">מסך מרכזי לבדיקת בעלות על עסקאות והוראות קבע, שיוך ידני ותיעוד האם המשלם הוא התלמיד או אחד ההורים. ברירת המחדל מציגה תלמידי BOGER.</p>
        <div className="quick-actions">
          <Link className="quick-action-btn quick-action-outline" href="/payments">חזרה למערכות תשלום</Link>
          <Link className="quick-action-btn quick-action-outline" href="/neon">רשימת תלמידים</Link>
        </div>
        <form method="get" className="grid" style={{ marginTop: 16, alignItems: "end" }}>
          <label>מתאריך<input type="date" name="dateFrom" defaultValue={dateFrom} required /></label>
          <label>עד תאריך<input type="date" name="dateTo" defaultValue={dateTo} required /></label>
          <button type="submit" className="quick-action-btn quick-action-primary">הצג טווח תאריכים</button>
        </form>
      </section>
      <PaymentLinkingClient
        dateFrom={dateFrom}
        dateTo={dateTo}
        transactions={[]}
        mandates={[]}
        students={students.filter(Boolean).map((student) => ({
          id: student.id,
          label: student.label || student.name || "ללא שם",
          tznum: student.tznum || "",
          className: student.class || "",
          institution: student.currentInstitution || ""
        }))}
        links={links}
        contactRecommendations={contactRecommendations}
        users={users.filter((item) => item.access_status === "approved").map((item) => ({ id: item.clerk_user_id, label: item.display_name || item.email }))}
        callAssignments={callAssignments.map((item) => ({ studentId: item.student_id, assigneeUserId: item.assignee_user_id }))}
        connections={connections}
        notice={clean(params?.notice)}
        error={clean(params?.error)}
      />
    </div>
  );
}
