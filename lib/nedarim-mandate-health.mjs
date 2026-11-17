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

function twoMonthsAfter(date) {
  const [year, month, day] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + 1, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function nedarimMandateHealth(mandate, lastSuccessfulChargeDate, today, historyKnown) {
  const baseline = lastSuccessfulChargeDate || nedarimDate(mandate.createdAt);
  const urgent = /כרטיס.{0,25}(?:חסום|נחסם|גנוב|נגנב|אבוד)|(?:חסום|גנוב|אבוד).{0,15}כרטיס|\b(?:stolen_card|lost_card|pickup_card|blocked_card)\b/i.test(mandate.errorText || "");
  const overdue = Boolean(historyKnown && baseline && today >= twoMonthsAfter(baseline));
  return {
    ...mandate,
    lastSuccessfulChargeDate,
    chargeHistoryKnown: historyKnown,
    status: urgent || overdue ? "issues" : "active",
    issueKind: urgent ? "card_requires_action" : overdue ? "no_successful_charge_two_months" : "",
    statusLabel: urgent ? "כרטיס דורש טיפול מיידי" : overdue ? "חודשיים ללא חיוב מוצלח" :
      !historyKnown || !baseline ? "היסטוריית חיובים לא זמינה" :
      mandate.errorText ? "חיוב נכשל · במעקב" : "פעילה"
  };
}
