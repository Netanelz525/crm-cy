// Nedarim reports dates in Israeli day/month/year order.
export function nedarimDate(value) {
  const input = String(value ?? "").trim();
  const local = input.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})(?=\s|,|$)/);
  const iso = local
    ? `${local[3].length === 2 ? "20" : ""}${local[3]}-${local[2].padStart(2, "0")}-${local[1].padStart(2, "0")}`
    : input.match(/^\d{4}-\d{2}-\d{2}(?=T|\s|$)/)?.[0];
  const date = new Date(iso);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === iso ? iso : "";
}

function elapsedMonths(date, today) {
  const [year, month, day] = date.split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
  const lastDay = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
  const months = (currentYear - year) * 12 + currentMonth - month;
  return Math.max(0, months - Number(currentDay < Math.min(day, lastDay)));
}

export function isConfirmedNedarimCharge(raw) {
  const approval = String(raw?.['מספר אישור'] ?? "").trim();
  const outcome = [raw?.["סטטוס"], raw?.["סטטוס עסקה"], raw?.["תוצאת עסקה"], raw?.["שגיאה"]]
    .filter(Boolean).join(" ");
  return /^[A-Z0-9-]+$/i.test(approval) && /[1-9]/.test(approval)
    && !/סירוב|סורב|נדח|נכשל|בוטל|מבוטל|לא אושר|declin|fail|reject|cancel|pending/i.test(outcome);
}

export function nedarimMandateHealth(mandate, lastSuccessfulChargeDate, today, historyKnown) {
  if (mandate.status === "completed") return { ...mandate, lastSuccessfulChargeDate, chargeHistoryKnown: historyKnown };
  const baseline = lastSuccessfulChargeDate || nedarimDate(mandate.createdAt);
  const urgent = /כרטיס.{0,25}(?:חסום|נחסם|גנוב|נגנב|אבוד)|(?:חסום|גנוב|אבוד).{0,15}כרטיס|\b(?:stolen_card|lost_card|pickup_card|blocked_card)\b/i.test(mandate.errorText || "");
  const monthsWithoutCharge = historyKnown && baseline ? elapsedMonths(baseline, today) : null;
  const overdue = monthsWithoutCharge >= 2;
  const monitoring = Boolean(mandate.errorText && !urgent && !overdue);
  const monthLabel = monthsWithoutCharge === 1 ? "חודש אחד" : monthsWithoutCharge === 2 ? "חודשיים" : `${monthsWithoutCharge} חודשים`;
  return {
    ...mandate,
    lastSuccessfulChargeDate,
    chargeHistoryKnown: historyKnown,
    status: urgent || overdue ? "issues" : "active",
    issueKind: urgent ? "card_requires_action" : overdue ? "no_successful_charge_two_months" : monitoring ? "payment_failure_monitoring" : "",
    statusLabel: urgent ? ["כרטיס דורש טיפול מיידי", monthsWithoutCharge > 0 ? `${monthLabel} ללא חיוב מוצלח` : ""].filter(Boolean).join(" · ") : overdue ? `${monthLabel} ללא חיוב מוצלח` :
      monitoring && monthsWithoutCharge === 1 ? "חודש אחד ללא חיוב מוצלח · במעקב" :
      monitoring ? "חיוב נכשל · במעקב" :
      !historyKnown || !baseline ? "היסטוריית חיובים לא זמינה" :
      "פעילה"
  };
}
