import { redirect } from "next/navigation";
import Link from "next/link";
import EmailComposerClient from "./email-composer-client";
import EmailFilterFormClient from "./email-filter-form-client";
import {
  buildDefaultSenderNameForStudents,
  getEmailCampaignDraft,
  getEmailCandidateStudents,
  getUnsubscribedEmailSet,
  listFavoriteEmailCampaignsForUser,
  listEmailUnsubscribes,
  normalizeRecipientRoles,
  summarizeEmailCandidates
} from "../../lib/email-campaigns";
import { getResendConfigStatus } from "../../lib/resend";
import { requireEmailSender, signInRedirectUrl } from "../../lib/rbac";
import { clean, CLASS_LABELS, INSTITUTIONS } from "../../lib/student-view";
import { ENUM_LABELS } from "../../lib/student-fields";
import { listStudentTags } from "../../lib/student-tags";
import {
  addEmailUnsubscribeAction,
  createEmailCampaignConfirmAction,
  removeEmailUnsubscribeAction,
  removeFavoriteEmailCampaignAction,
  reopenEmailCampaignAction
} from "./actions";

function institutionLabel(value) {
  const key = clean(value).toUpperCase();
  return INSTITUTIONS[key] || clean(value) || "-";
}

function classLabel(value) {
  const key = clean(value).toUpperCase();
  return CLASS_LABELS[key] || clean(value) || "-";
}

function renderFavoriteMeta(campaign) {
  return [
    campaign.sender_name || "-",
    campaign.institution ? institutionLabel(campaign.institution) : "",
    campaign.class_filter ? classLabel(campaign.class_filter) : ""
  ].filter(Boolean).join(" | ");
}

function getSearchParamList(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  const single = clean(value);
  return single ? [single] : [];
}

function hasSearchParam(searchParams, key) {
  return Boolean(searchParams) && Object.prototype.hasOwnProperty.call(searchParams, key);
}

function summarizeActiveFilters(filters, availableTags) {
  const parts = [];
  if (filters.institution.length) parts.push({ label: "מוסד", value: filters.institution.map(institutionLabel).join(", ") });
  if (filters.class.length) parts.push({ label: "שיעור", value: filters.class.map(classLabel).join(", ") });
  if (filters.registration.length) parts.push({ label: "רישום", value: filters.registration.map((value) => ENUM_LABELS.registration?.[value] || value).join(", ") });
  if (filters.familystatus.length) parts.push({ label: "מצב משפחתי", value: filters.familystatus.map((value) => ENUM_LABELS.familystatus?.[value] || value).join(", ") });
  if (filters.tagIds.length) {
    const names = availableTags
      .filter((tag) => filters.tagIds.includes(tag.id))
      .map((tag) => tag.name)
      .filter(Boolean);
    if (names.length) parts.push({ label: "תווית", value: names.join(", ") });
  }
  if (filters.q) parts.push({ label: "חיפוש", value: filters.q });
  if (filters.recipientRoles.length !== 2 || !filters.recipientRoles.includes("father") || !filters.recipientRoles.includes("mother")) {
    const recipientModeLabels = {
      father: "אבא",
      mother: "אמא",
      student: "תלמיד"
    };
    parts.push({ label: "למי לשלוח", value: filters.recipientRoles.map((value) => recipientModeLabels[value] || value).join(", ") });
  }
  return parts;
}

export default async function EmailPage({ searchParams }) {
  const user = await requireEmailSender();
  if (!user) redirect(await signInRedirectUrl());

  const resolvedSearchParams = await searchParams;
  const draftId = clean(resolvedSearchParams?.draft);
  const draftRecord = draftId ? await getEmailCampaignDraft(draftId) : null;
  const draft = draftRecord?.draft_json || null;
  const composeMode = clean(resolvedSearchParams?.compose) === "1" || Boolean(draftId);
  const hasInstitutionParam = hasSearchParam(resolvedSearchParams, "institution");
  const hasClassParam = hasSearchParam(resolvedSearchParams, "class");
  const hasRegistrationParam = hasSearchParam(resolvedSearchParams, "registration");
  const hasFamilyStatusParam = hasSearchParam(resolvedSearchParams, "familystatus");
  const hasTagIdsParam = hasSearchParam(resolvedSearchParams, "tagIds");
  const hasQueryParam = hasSearchParam(resolvedSearchParams, "q");
  const hasRecipientRolesParam = hasSearchParam(resolvedSearchParams, "recipientRoles");
  const searchTagIds = getSearchParamList(resolvedSearchParams?.tagIds);
  const searchInstitution = getSearchParamList(resolvedSearchParams?.institution);
  const searchClass = getSearchParamList(resolvedSearchParams?.class);
  const searchRegistration = getSearchParamList(resolvedSearchParams?.registration);
  const searchFamilyStatus = getSearchParamList(resolvedSearchParams?.familystatus);
  const searchQuery = clean(resolvedSearchParams?.q);
  const searchRecipientRoles = getSearchParamList(resolvedSearchParams?.recipientRoles);
  const filters = {
    institution: hasInstitutionParam ? searchInstitution : Array.isArray(draft?.institution) ? draft.institution.map(clean).filter(Boolean) : clean(draft?.institution) ? [clean(draft.institution)] : [],
    class: hasClassParam ? searchClass : Array.isArray(draft?.class) ? draft.class.map(clean).filter(Boolean) : clean(draft?.class) ? [clean(draft.class)] : [],
    registration: hasRegistrationParam ? searchRegistration : Array.isArray(draft?.registration) ? draft.registration.map(clean).filter(Boolean) : clean(draft?.registration) ? [clean(draft.registration)] : [],
    familystatus: hasFamilyStatusParam ? searchFamilyStatus : Array.isArray(draft?.familystatus) ? draft.familystatus.map(clean).filter(Boolean) : clean(draft?.familystatus) ? [clean(draft.familystatus)] : [],
    tagIds: hasTagIdsParam
      ? searchTagIds
      : Array.isArray(draft?.tagIds) ? draft.tagIds.map(clean).filter(Boolean) : [],
    q: hasQueryParam ? searchQuery : clean(draft?.q),
    recipientRoles: hasRecipientRolesParam
      ? normalizeRecipientRoles(searchRecipientRoles)
      : normalizeRecipientRoles(draft?.recipientRoles || draft?.recipientMode),
    selectedStudentIds: Array.isArray(draft?.selectedStudentIds)
      ? draft.selectedStudentIds.map(clean).filter(Boolean)
      : Array.isArray(resolvedSearchParams?.studentIds)
        ? resolvedSearchParams.studentIds.map(clean).filter(Boolean)
        : clean(resolvedSearchParams?.studentIds) ? [clean(resolvedSearchParams.studentIds)] : []
  };

  const subject = clean(draft?.subject || resolvedSearchParams?.subject) || "עדכון חשוב ממערכת התלמידים";
  const initialHtml = clean(draft?.bodyHtml || resolvedSearchParams?.contentHtml || resolvedSearchParams?.bodyHtml) || "<p>שלום,</p><p>רצינו לעדכן אותך בנושא חשוב.</p><p>בברכה,<br>משרד הישיבה</p>";
  const includeGreeting = draft ? draft.includeGreeting !== false : clean(resolvedSearchParams?.includeGreeting) !== "0";
  const sent = clean(resolvedSearchParams?.sent);
  const failed = clean(resolvedSearchParams?.failed);
  const skipped = clean(resolvedSearchParams?.skipped);
  const error = clean(resolvedSearchParams?.error);
  const notice = clean(resolvedSearchParams?.notice);
  const blacklistUpdated = clean(resolvedSearchParams?.blacklistUpdated) === "1";
  const reopened = clean(resolvedSearchParams?.reopened) === "1";
  const favoriteSaved = clean(resolvedSearchParams?.favoriteSaved) === "1";
  const favoriteRemoved = clean(resolvedSearchParams?.favoriteRemoved) === "1";

  const resendStatus = getResendConfigStatus();
  const availableTags = await listStudentTags();
  const students = composeMode ? await getEmailCandidateStudents(filters) : [];
  const blacklistedEmails = composeMode
    ? await getUnsubscribedEmailSet(
      students.flatMap((student) => [
        clean(student?.email?.primaryEmail),
        clean(student?.fatherEmail?.primaryEmail),
        clean(student?.motherEmail?.primaryEmail)
      ]).filter(Boolean)
    )
    : new Set();
  const studentsWithBlacklistState = composeMode
    ? students.map((student) => {
      const recipientEmails = [
        clean(student?.email?.primaryEmail),
        clean(student?.fatherEmail?.primaryEmail),
        clean(student?.motherEmail?.primaryEmail)
      ].map((value) => value.toLowerCase()).filter(Boolean);
      const blockedEmails = recipientEmails.filter((email) => blacklistedEmails.has(email));
      return {
        ...student,
        hasBlacklistedEmail: blockedEmails.length > 0,
        blacklistedEmails: blockedEmails
      };
    })
    : [];
  const senderName = user.can_edit_email_sender
    ? (clean(draft?.senderName || resolvedSearchParams?.senderName) || buildDefaultSenderNameForStudents(studentsWithBlacklistState))
    : buildDefaultSenderNameForStudents(studentsWithBlacklistState);
  const replyTo = clean(draft?.replyTo || resolvedSearchParams?.replyTo) || clean(resendStatus.defaultReplyTo);
  const summary = summarizeEmailCandidates(studentsWithBlacklistState, filters.recipientRoles);
  const unsubscribes = await listEmailUnsubscribes(200);
  const favoriteCampaigns = await listFavoriteEmailCampaignsForUser(user.clerk_user_id, 10);
  const hasRecipientSource = Boolean(
    filters.institution.length
    || filters.class.length
    || filters.registration.length
    || filters.familystatus.length
    || filters.tagIds.length
    || filters.q
    || filters.selectedStudentIds.length
  );
  const hasActiveFilterValues = Boolean(
    filters.institution.length
    || filters.class.length
    || filters.registration.length
    || filters.familystatus.length
    || filters.tagIds.length
    || filters.q
    || filters.recipientRoles.length !== 2
    || !filters.recipientRoles.includes("father")
    || !filters.recipientRoles.includes("mother")
  );
  const activeFilterSummary = summarizeActiveFilters(filters, availableTags);
  const institutionOptions = Object.entries(INSTITUTIONS).map(([value, label]) => ({ value, label }));
  const classOptions = Object.entries(ENUM_LABELS.class || {}).map(([value, label]) => ({ value, label }));
  const registrationOptions = Object.entries(ENUM_LABELS.registration || {}).map(([value, label]) => ({ value, label }));
  const familystatusOptions = Object.entries(ENUM_LABELS.familystatus || {}).map(([value, label]) => ({ value, label }));

  return (
    <>
      <div className="card glass email-hero">
        <div>
          <p className="email-kicker">מרכז מיילים</p>
          <h1>שליחת הודעות לתלמידים והורים</h1>
          <p className="muted">
            {composeMode
              ? "כאן מגדירים את התפוצה הנוכחית בלבד: מסננים, בוחרים נמענים, עורכים את ההודעה וממשיכים לאישור סופי."
              : "דף הבית של מערכת המיילים מציג קמפיינים מועדפים ורשימה שחורה. את עורך ההודעות פותחים רק כשבוחרים להתחיל תפוצה חדשה."}
          </p>
          <div className="quick-actions" style={{ marginTop: 12 }}>
            <Link className="chip-link" href="/email?compose=1">תפוצה חדשה</Link>
            {user.can_view_email_reports ? <Link className="chip-link" href="/email/campaigns">הודעות תפוצה קודמות</Link> : null}
            <Link className="chip-link" href="/neon">חזרה למסך תלמידים</Link>
          </div>
        </div>
        <div className="email-hero-status">
          <span className={resendStatus.configured ? "email-status-ok" : "email-status-warn"}>
            {resendStatus.configured ? "Resend מחובר" : "חסר Resend API key"}
          </span>
          <small>{resendStatus.fromEmail}</small>
        </div>
      </div>

      {sent ? (
        <div className="ok">
          השליחה הסתיימה: {sent} נשלחו, {failed || 0} נכשלו, {skipped || 0} דולגו.
        </div>
      ) : null}
      {!sent && notice ? <div className="ok">{notice}</div> : null}
      {reopened ? <div className="ok">ההודעה הקודמת נטענה כטיוטה חדשה עם הגדרות הסינון המקוריות, ואפשר לעדכן אותה לפני שליחה מחדש.</div> : null}
      {favoriteSaved ? <div className="ok">הקמפיין נשמר במועדפים לשימוש חוזר מהיר.</div> : null}
      {favoriteRemoved ? <div className="ok">הקמפיין הוסר מרשימת המועדפים.</div> : null}
      {blacklistUpdated ? <div className="ok">הרשימה השחורה עודכנה בהצלחה.</div> : null}
      {error ? <div className="card muted">{error}</div> : null}

      {composeMode ? (
        <>
          <EmailFilterFormClient
            draftId={draftId}
            filters={filters}
            hasActiveFilterValues={hasActiveFilterValues}
            activeFilterSummary={activeFilterSummary}
            institutionOptions={institutionOptions}
            classOptions={classOptions}
            registrationOptions={registrationOptions}
            familystatusOptions={familystatusOptions}
            availableTags={availableTags}
          />

          <form action={createEmailCampaignConfirmAction} encType="multipart/form-data">
            <input type="hidden" name="draftId" value={draftId} />
            {filters.institution.map((value) => <input key={`institution-${value}`} type="hidden" name="institution" value={value} />)}
            {filters.class.map((value) => <input key={`class-${value}`} type="hidden" name="class" value={value} />)}
            {filters.registration.map((value) => <input key={`registration-${value}`} type="hidden" name="registration" value={value} />)}
            {filters.familystatus.map((value) => <input key={`familystatus-${value}`} type="hidden" name="familystatus" value={value} />)}
            {filters.tagIds.map((tagId) => <input key={tagId} type="hidden" name="tagIds" value={tagId} />)}
            <input type="hidden" name="q" value={filters.q} />
            {filters.recipientRoles.map((value) => <input key={`recipient-${value}`} type="hidden" name="recipientRoles" value={value} />)}
            <EmailComposerClient
              hasRecipientSource={hasRecipientSource}
              recipientRoles={filters.recipientRoles}
              students={studentsWithBlacklistState}
              summary={summary}
              initialSubject={subject}
              initialHtml={initialHtml}
              initialSenderName={senderName}
              initialReplyTo={replyTo}
              initialIncludeGreeting={includeGreeting}
              senderNameEditable={user.can_edit_email_sender}
              resendConfigured={resendStatus.configured}
            />
          </form>
        </>
      ) : null}

      {!composeMode ? (
        <div className="email-layout" style={{ marginTop: 18 }}>
          <section className="email-panel">
            <div className="email-log-card">
              <div className="email-section-title">
                <h2>קמפיינים מועדפים</h2>
                <span>{favoriteCampaigns.length} שמורים</span>
              </div>
              {!favoriteCampaigns.length ? (
                <div className="muted">שמור קמפיין מתוך דף קמפיין קיים, והוא יופיע כאן לפתיחה מהירה.</div>
              ) : (
                <div className="email-favorite-list">
                  {favoriteCampaigns.map((campaign) => (
                    <div key={campaign.campaign_id} className="email-log-row email-favorite-row">
                      <div>
                        <b>{campaign.label || campaign.subject}</b>
                        <small>{campaign.subject}</small>
                        <small>{renderFavoriteMeta(campaign)}</small>
                      </div>
                      <div className="email-favorite-actions">
                        <form action={reopenEmailCampaignAction}>
                          <input type="hidden" name="campaignId" value={campaign.campaign_id} />
                          <button type="submit" className="chip-link">שליחה מחדש</button>
                        </form>
                        <Link className="chip-link" href={`/email/campaigns/${campaign.campaign_id}`}>פתח</Link>
                        <form action={removeFavoriteEmailCampaignAction}>
                          <input type="hidden" name="campaignId" value={campaign.campaign_id} />
                          <input type="hidden" name="returnTo" value="/email" />
                          <button type="submit" className="chip-link">הסר</button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="email-certainty-card">
              <h2>מה אפשר לעשות מכאן</h2>
              <div className="email-certainty-steps">
                <div><b>חדש</b><span>פתיחת תפוצה</span><small>לחץ על תפוצה חדשה כדי לעבור למסך הכתיבה.</small></div>
                <div><b>מועדף</b><span>שימוש חוזר</span><small>פתח קמפיין שמור והמשך לשליחה מחדש במהירות.</small></div>
                <div><b>חסום</b><span>רשימה שחורה</span><small>ניהול כתובות שלא יקבלו הודעות מהמערכת.</small></div>
              </div>
            </div>
          </section>

          <aside className="email-panel">
            <div className="email-log-card">
              <div className="email-section-title">
                <h2>רשימה שחורה</h2>
                <span>{unsubscribes.length} כתובות</span>
              </div>
              <form action={addEmailUnsubscribeAction} className="email-blacklist-form">
                <input name="recipientEmail" type="email" placeholder="כתובת מייל" required />
                <input name="recipientName" placeholder="שם נמען" />
                <input name="reasonText" placeholder="סיבת חסימה" />
                <button type="submit">הוסף לרשימה</button>
              </form>
              {!unsubscribes.length ? (
                <div className="muted">עדיין אין כתובות חסומות.</div>
              ) : (
                <div className="email-blacklist-list">
                  {unsubscribes.map((entry) => (
                    <div key={entry.recipient_email} className="email-log-row email-blacklist-row">
                      <div>
                        <b>{entry.recipient_name || entry.recipient_email}</b>
                        <small>{entry.recipient_email}</small>
                        <small>{entry.reason_text || "ללא סיבה"}</small>
                      </div>
                      <form action={removeEmailUnsubscribeAction}>
                        <input type="hidden" name="recipientEmail" value={entry.recipient_email} />
                        <button type="submit" className="chip-link">הסר מהרשימה</button>
                      </form>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
