import { redirect } from "next/navigation";
import Link from "next/link";
import EmailComposerClient from "./email-composer-client";
import {
  buildDefaultSenderNameForStudents,
  getEmailCampaignDraft,
  getEmailCandidateStudents,
  getUnsubscribedEmailSet,
  listFavoriteEmailCampaignsForUser,
  listEmailUnsubscribes,
  summarizeEmailCandidates
} from "../../lib/email-campaigns";
import { getResendConfigStatus } from "../../lib/resend";
import { requireEmailSender } from "../../lib/rbac";
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

function summarizeFilterSettings(filters, recipientMode, availableTags) {
  const parts = [];
  if (filters.institution) parts.push({ label: "מוסד", value: institutionLabel(filters.institution) });
  if (filters.class) parts.push({ label: "שיעור", value: classLabel(filters.class) });
  if (filters.registration) parts.push({ label: "רישום", value: ENUM_LABELS.registration?.[filters.registration] || filters.registration });
  if (filters.familystatus) parts.push({ label: "מצב משפחתי", value: ENUM_LABELS.familystatus?.[filters.familystatus] || filters.familystatus });
  if (filters.tagIds.length) {
    const names = availableTags
      .filter((tag) => filters.tagIds.includes(tag.id))
      .map((tag) => tag.name)
      .filter(Boolean);
    if (names.length) parts.push({ label: "תוויות", value: names.join(", ") });
  }
  if (filters.q) parts.push({ label: "חיפוש", value: filters.q });

  const recipientModeLabels = {
    parents: "הורים בלבד",
    father: "אב בלבד",
    mother: "אם בלבד",
    student: "תלמיד בלבד",
    all: "הורים ותלמיד"
  };
  parts.push({ label: "למי לשלוח", value: recipientModeLabels[recipientMode] || "הורים בלבד", accent: true });

  return parts;
}

function buildComposeFilterHref({ draftId, filters, clearField, clearTagId }) {
  const params = new URLSearchParams();
  params.set("compose", "1");
  if (draftId) params.set("draft", draftId);

  params.set("institution", clearField === "institution" ? "" : filters.institution);
  params.set("class", clearField === "class" ? "" : filters.class);
  params.set("registration", clearField === "registration" ? "" : filters.registration);
  params.set("familystatus", clearField === "familystatus" ? "" : filters.familystatus);
  params.set("q", clearField === "q" ? "" : filters.q);
  params.set("recipientMode", clearField === "recipientMode" ? "parents" : filters.recipientMode);

  if (clearField === "tagIds") {
    params.set("tagIds", "");
  } else {
    const nextTagIds = clearTagId
      ? filters.tagIds.filter((tagId) => tagId !== clearTagId)
      : filters.tagIds;
    if (!nextTagIds.length) {
      params.set("tagIds", "");
    } else {
      for (const tagId of nextTagIds) {
        params.append("tagIds", tagId);
      }
    }
  }

  return `/email?${params.toString()}`;
}

export default async function EmailPage({ searchParams }) {
  const user = await requireEmailSender();
  if (!user) redirect("/sign-in");

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
  const hasRecipientModeParam = hasSearchParam(resolvedSearchParams, "recipientMode");
  const searchTagIds = getSearchParamList(resolvedSearchParams?.tagIds);
  const searchInstitution = clean(resolvedSearchParams?.institution);
  const searchClass = clean(resolvedSearchParams?.class);
  const searchRegistration = clean(resolvedSearchParams?.registration);
  const searchFamilyStatus = clean(resolvedSearchParams?.familystatus);
  const searchQuery = clean(resolvedSearchParams?.q);
  const searchRecipientMode = clean(resolvedSearchParams?.recipientMode);
  const filters = {
    institution: hasInstitutionParam ? searchInstitution : clean(draft?.institution),
    class: hasClassParam ? searchClass : clean(draft?.class),
    registration: hasRegistrationParam ? searchRegistration : clean(draft?.registration),
    familystatus: hasFamilyStatusParam ? searchFamilyStatus : clean(draft?.familystatus),
    tagIds: hasTagIdsParam
      ? searchTagIds
      : Array.isArray(draft?.tagIds) ? draft.tagIds.map(clean).filter(Boolean) : [],
    q: hasQueryParam ? searchQuery : clean(draft?.q),
    recipientMode: hasRecipientModeParam ? (searchRecipientMode || "parents") : (clean(draft?.recipientMode) || "parents"),
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
  const summary = summarizeEmailCandidates(studentsWithBlacklistState, filters.recipientMode);
  const unsubscribes = await listEmailUnsubscribes(200);
  const favoriteCampaigns = await listFavoriteEmailCampaignsForUser(user.clerk_user_id, 10);
  const hasRecipientSource = Boolean(
    filters.institution
    || filters.class
    || filters.registration
    || filters.familystatus
    || filters.tagIds.length
    || filters.q
    || filters.selectedStudentIds.length
  );
  const filterSummary = summarizeFilterSettings(filters, filters.recipientMode, availableTags);
  const activeFilterLinks = filterSummary.map((item) => {
    if (item.label === "מוסד") {
      return { ...item, href: buildComposeFilterHref({ draftId, filters, clearField: "institution" }) };
    }
    if (item.label === "שיעור") {
      return { ...item, href: buildComposeFilterHref({ draftId, filters, clearField: "class" }) };
    }
    if (item.label === "רישום") {
      return { ...item, href: buildComposeFilterHref({ draftId, filters, clearField: "registration" }) };
    }
    if (item.label === "מצב משפחתי") {
      return { ...item, href: buildComposeFilterHref({ draftId, filters, clearField: "familystatus" }) };
    }
    if (item.label === "חיפוש") {
      return { ...item, href: buildComposeFilterHref({ draftId, filters, clearField: "q" }) };
    }
    if (item.label === "למי לשלוח") {
      return { ...item, href: buildComposeFilterHref({ draftId, filters, clearField: "recipientMode" }) };
    }
    return { ...item, href: buildComposeFilterHref({ draftId, filters, clearField: "tagIds" }) };
  });

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
          <details className="email-filter-card" open={false}>
            <summary>
              <span>סינון נמענים</span>
              <div className="email-active-filters">
                {activeFilterLinks.length ? activeFilterLinks.map((item) => (
                  <span
                    key={`${item.label}-${item.value}`}
                    className={`email-filter-pill${item.accent ? " email-filter-pill-accent" : ""}`}
                  >
                    <b>{item.label}</b>
                    <span>{item.value}</span>
                  </span>
                )) : (
                  <span className="email-filter-pill">
                    <span>לא הוגדרו מסננים עדיין</span>
                  </span>
                )}
              </div>
            </summary>
            <form action="/email" method="get">
              <input type="hidden" name="compose" value="1" />
              <input type="hidden" name="draft" value={draftId} />
              {activeFilterLinks.length ? (
                <div className="email-active-filter-actions">
                  <Link
                    className="email-filter-pill email-filter-pill-clear"
                    href={`/email?compose=1${draftId ? `&draft=${encodeURIComponent(draftId)}` : ""}&institution=&class=&registration=&familystatus=&tagIds=&q=&recipientMode=parents`}
                  >
                    <b>נקה הכול</b>
                    <span>חזור לברירת המחדל של הסינון</span>
                    <strong>איפוס</strong>
                  </Link>
                  {activeFilterLinks.map((item) => (
                    <Link
                      key={`clear-${item.label}-${item.value}`}
                      className={`email-filter-pill email-filter-pill-clear${item.accent ? " email-filter-pill-accent" : ""}`}
                      href={item.href}
                    >
                      <b>{item.label}</b>
                      <span>{item.value}</span>
                      <strong>נקה</strong>
                    </Link>
                  ))}
                </div>
              ) : null}
              <div className="email-form-grid">
                <label>
                  מוסד
                  <select name="institution" defaultValue={filters.institution}>
                    <option value="">כל המוסדות</option>
                    {Object.entries(INSTITUTIONS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  שיעור
                  <select name="class" defaultValue={filters.class}>
                    <option value="">כל השיעורים</option>
                    {Object.entries(ENUM_LABELS.class || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  רישום
                  <select name="registration" defaultValue={filters.registration}>
                    <option value="">כל מצבי הרישום</option>
                    {Object.entries(ENUM_LABELS.registration || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  מצב משפחתי
                  <select name="familystatus" defaultValue={filters.familystatus}>
                    <option value="">כל המצבים</option>
                    {Object.entries(ENUM_LABELS.familystatus || {}).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  תווית
                  <select name="tagIds" defaultValue={filters.tagIds[0] || ""}>
                    <option value="">כל התוויות</option>
                    {availableTags.map((tag) => (
                      <option key={tag.id} value={tag.id}>{tag.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  למי לשלוח
                  <select name="recipientMode" defaultValue={filters.recipientMode}>
                    <option value="parents">הורים בלבד</option>
                    <option value="father">אב בלבד</option>
                    <option value="mother">אם בלבד</option>
                    <option value="student">תלמיד בלבד</option>
                    <option value="all">שניהם</option>
                  </select>
                </label>
                <label>
                  חיפוש תלמיד
                  <input name="q" defaultValue={filters.q} placeholder="שם, מייל או טלפון" />
                </label>
              </div>
              <input type="hidden" name="subject" value={subject} />
              <input type="hidden" name="senderName" value={senderName} />
              <input type="hidden" name="contentHtml" value={initialHtml} />
              <button type="submit">עדכן רשימה</button>
            </form>
          </details>

          <form action={createEmailCampaignConfirmAction} encType="multipart/form-data">
            <input type="hidden" name="draftId" value={draftId} />
            <input type="hidden" name="institution" value={filters.institution} />
            <input type="hidden" name="class" value={filters.class} />
            <input type="hidden" name="registration" value={filters.registration} />
            <input type="hidden" name="familystatus" value={filters.familystatus} />
            {filters.tagIds.map((tagId) => <input key={tagId} type="hidden" name="tagIds" value={tagId} />)}
            <input type="hidden" name="q" value={filters.q} />
            <input type="hidden" name="recipientMode" value={filters.recipientMode} />
            <EmailComposerClient
              hasRecipientSource={hasRecipientSource}
              recipientMode={filters.recipientMode}
              students={studentsWithBlacklistState}
              summary={summary}
              initialSubject={subject}
              initialHtml={initialHtml}
              initialSenderName={senderName}
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
