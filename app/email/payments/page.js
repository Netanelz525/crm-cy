import Link from "next/link";
import { redirect } from "next/navigation";
import PaymentReportEmailComposerClient from "./payment-report-email-composer-client";
import { createPaymentEmailCampaignConfirmAction } from "../actions";
import { getEmailCampaignDraft, normalizeCustomRecipients } from "../../../lib/email-campaigns";
import { getResendConfigStatus } from "../../../lib/resend";
import { requireEmailSender } from "../../../lib/rbac";
import { buildPaymentExportSearchParams, filterAndSortPaymentTransactions } from "../../../lib/payment-report";
import { getPaymentDashboard, getPaymentMandatesDashboard, listPaymentConnections } from "../../../lib/payment-systems";

function clean(value) {
  return String(value || "").trim();
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  return clean(value) ? [clean(value)] : [];
}

function buildPaymentRecipients(transactions = []) {
  const byEmail = new Map();
  for (const transaction of transactions) {
    const email = clean(transaction?.email).toLowerCase();
    if (!email) continue;
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        id: email,
        email,
        name: clean(transaction?.customerName) || email,
        sourceLabel: clean(transaction?.connectionLabel),
        providerLabel: clean(transaction?.providerLabel)
      });
    }
  }
  return Array.from(byEmail.values());
}

function buildPaymentMandateRecipients(mandates = []) {
  const byEmail = new Map();
  for (const mandate of mandates) {
    const email = clean(mandate?.email).toLowerCase();
    if (!email) continue;
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        id: email,
        email,
        name: clean(mandate?.customerName) || email,
        sourceLabel: clean(mandate?.connectionLabel),
        providerLabel: clean(mandate?.providerLabel),
        extraLabel: clean(mandate?.statusLabel || mandate?.status)
      });
    }
  }
  return Array.from(byEmail.values());
}

export default async function PaymentEmailPage({ searchParams }) {
  const user = await requireEmailSender();
  if (!user) redirect("/sign-in");

  const resolvedSearchParams = await searchParams;
  const draftId = clean(resolvedSearchParams?.draft);
  const draftRecord = draftId ? await getEmailCampaignDraft(draftId) : null;
  const draft = draftRecord?.draft_json || null;
  const dateFrom = clean(resolvedSearchParams?.dateFrom);
  const dateTo = clean(resolvedSearchParams?.dateTo);
  const reportType = clean(resolvedSearchParams?.reportType) === "mandates" ? "mandates" : "transactions";
  const mandateStatus = ["active", "issues", "completedNoRemaining", "all"].includes(clean(resolvedSearchParams?.mandateStatus))
    ? clean(resolvedSearchParams?.mandateStatus)
    : "active";
  const providers = parseList(resolvedSearchParams?.provider);
  const requestedConnectionIds = parseList(resolvedSearchParams?.connectionId);
  const searchTerm = clean(resolvedSearchParams?.searchTerm);
  const sortBy = clean(resolvedSearchParams?.sortBy) || "date";
  const sortDir = clean(resolvedSearchParams?.sortDir) || "desc";
  const singleRecipientId = clean(resolvedSearchParams?.singleRecipientId);
  const notice = clean(resolvedSearchParams?.notice);
  const error = clean(resolvedSearchParams?.error);
  const reopened = clean(resolvedSearchParams?.reopened) === "1";
  const draftReportConfig = draft?.reportConfig || {};
  const effectiveReportType = clean(draftReportConfig?.reportType) === "mandates" ? "mandates" : reportType;
  const effectiveDateFrom = clean(draftReportConfig?.dateFrom) || dateFrom;
  const effectiveDateTo = clean(draftReportConfig?.dateTo) || dateTo;
  const effectiveMandateStatus = ["active", "issues", "completedNoRemaining", "all"].includes(clean(draftReportConfig?.mandateStatus))
    ? clean(draftReportConfig?.mandateStatus)
    : mandateStatus;
  const effectiveProviders = Array.isArray(draftReportConfig?.providers) && draftReportConfig.providers.length
    ? draftReportConfig.providers.map(clean).filter(Boolean)
    : providers;
  const effectiveSearchTerm = clean(draftReportConfig?.searchTerm) || searchTerm;
  const effectiveSortBy = clean(draftReportConfig?.sortBy) || sortBy;
  const effectiveSortDir = clean(draftReportConfig?.sortDir) || sortDir;
  const effectiveSingleRecipientId = clean(draftReportConfig?.singleRecipientId) || singleRecipientId;

  if (!draft && effectiveReportType !== "mandates" && (!effectiveDateFrom || !effectiveDateTo)) {
    redirect("/payments?error=" + encodeURIComponent("כדי לשלוח מייל מדוח עסקאות צריך לפתוח קודם דוח עסקאות בטווח תאריכים."));
  }

  const activeConnections = await listPaymentConnections({ activeOnly: true });
  const requestedIds = Array.isArray(draftReportConfig?.connectionIds) && draftReportConfig.connectionIds.length
    ? draftReportConfig.connectionIds.map(clean).filter(Boolean)
    : requestedConnectionIds;
  const connectionIds = requestedIds.length
    ? activeConnections.map((connection) => connection.id).filter((id) => requestedIds.includes(id))
    : activeConnections.map((connection) => connection.id);
  const recipients = draft ? normalizeCustomRecipients(draft?.customRecipients) : [];
  let computedRecipients = recipients;
  if (!draft) {
    if (effectiveReportType === "mandates") {
      const dashboard = await getPaymentMandatesDashboard({ connectionIds });
      const visibleMandates = filterAndSortPaymentTransactions(dashboard.mandates, {
        providers: effectiveProviders,
        connectionIds,
        mandateStatus: effectiveMandateStatus,
        searchTerm: effectiveSearchTerm,
        sortBy: effectiveSortBy,
        sortDir: effectiveSortDir
      });
      computedRecipients = buildPaymentMandateRecipients(visibleMandates);
    } else {
      const dashboard = await getPaymentDashboard({
        connectionIds,
        dateFrom: effectiveDateFrom,
        dateTo: effectiveDateTo
      });
      const visibleTransactions = filterAndSortPaymentTransactions(dashboard.transactions, {
        providers: effectiveProviders,
        connectionIds,
        searchTerm: effectiveSearchTerm,
        sortBy: effectiveSortBy,
        sortDir: effectiveSortDir
      });
      computedRecipients = buildPaymentRecipients(visibleTransactions);
    }
    if (effectiveSingleRecipientId) {
      computedRecipients = computedRecipients.filter((recipient) => clean(recipient.id).toLowerCase() === effectiveSingleRecipientId.toLowerCase());
    }
  }
  const resendStatus = getResendConfigStatus();
  const reportQuery = buildPaymentExportSearchParams({
    reportType: effectiveReportType,
    dateFrom: effectiveDateFrom,
    dateTo: effectiveDateTo,
    providers: effectiveProviders,
    connectionIds,
    mandateStatus: effectiveMandateStatus,
    searchTerm: effectiveSearchTerm,
    sortBy: effectiveSortBy,
    sortDir: effectiveSortDir
  });
  const editQuery = effectiveSingleRecipientId
    ? `${reportQuery}&singleRecipientId=${encodeURIComponent(effectiveSingleRecipientId)}`
    : reportQuery;
  const reportLabel = effectiveReportType === "mandates" ? "הוראות הקבע" : "העסקאות";
  const backToReportHref = effectiveReportType === "mandates"
    ? `/payments?run=1&${reportQuery}`
    : `/payments?run=1&${reportQuery}`;

  return (
    <>
      <div className="card glass email-hero">
        <div>
          <p className="email-kicker">{effectiveReportType === "mandates" ? "תפוצה מדוח הוראות קבע" : "תפוצה מדוח עסקאות"}</p>
          <h1>{effectiveSingleRecipientId ? "שליחת מייל לרשומה בודדת" : "שליחת מייל לנמעני דוח התרומות"}</h1>
          <p className="muted">
            נוצרה כאן רשימת הנמענים מתוך כתובות המייל שהופיעו בדוח {reportLabel} שבחרת. אפשר לערוך הודעה אחת ולשלוח אותה לכל הרשומות עם מייל.
          </p>
          <div className="quick-actions" style={{ marginTop: 12 }}>
            <Link className="chip-link" href={backToReportHref}>חזרה לדוח</Link>
            <Link className="chip-link" href="/email/campaigns">הודעות תפוצה קודמות</Link>
          </div>
        </div>
        <div className="email-hero-status">
          <span className={resendStatus.configured ? "email-status-ok" : "email-status-warn"}>
            {resendStatus.configured ? "Resend מחובר" : "חסר Resend API key"}
          </span>
          <small>{computedRecipients.length} נמענים עם מייל</small>
        </div>
      </div>

      {notice ? <div className="ok">{notice}</div> : null}
      {reopened ? <div className="ok">הקמפיין נטען מחדש כטיוטה, ואפשר לעדכן אותו לפני שליחה נוספת.</div> : null}
      {error ? <div className="card muted">{error}</div> : null}

      <form action={createPaymentEmailCampaignConfirmAction} encType="multipart/form-data">
        <input type="hidden" name="draftId" value={draftId} />
        <input type="hidden" name="reportType" value={effectiveReportType} />
        <input type="hidden" name="dateFrom" value={effectiveDateFrom} />
        <input type="hidden" name="dateTo" value={effectiveDateTo} />
        <input type="hidden" name="mandateStatus" value={effectiveMandateStatus} />
        <input type="hidden" name="searchTerm" value={effectiveSearchTerm} />
        <input type="hidden" name="sortBy" value={effectiveSortBy} />
        <input type="hidden" name="sortDir" value={effectiveSortDir} />
        <input type="hidden" name="singleRecipientId" value={effectiveSingleRecipientId} />
        {effectiveProviders.map((provider) => <input key={`provider-${provider}`} type="hidden" name="provider" value={provider} />)}
        {connectionIds.map((connectionId) => <input key={`connection-${connectionId}`} type="hidden" name="connectionId" value={connectionId} />)}
        <PaymentReportEmailComposerClient
          recipients={computedRecipients}
          initialSubject={clean(draft?.subject) || (effectiveReportType === "mandates" ? "עדכון בנושא הוראת הקבע שלך" : "עדכון חשוב בנושא התרומה שלך")}
          initialHtml={clean(draft?.bodyHtml) || "<p>שלום {{שם}},</p><p>תודה על תמיכתך. רצינו לשתף אותך בעדכון חשוב.</p><p>בברכה,<br>מחלקת תרומות</p>"}
          initialSenderName={clean(draft?.senderName) || "מחלקת תרומות"}
          initialIncludeGreeting={draft ? draft.includeGreeting !== false : true}
          senderNameEditable={user.can_edit_email_sender}
          resendConfigured={resendStatus.configured}
        />
      </form>
    </>
  );
}
