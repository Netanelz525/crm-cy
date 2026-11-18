import test from "node:test";
import assert from "node:assert/strict";
import { isConfirmedNedarimCharge, nedarimDate, nedarimMandateHealth } from "../lib/nedarim-mandate-health.mjs";

const health = (last, today, errorText = "", known = true, createdAt = "04/01/2025") =>
  nedarimMandateHealth({ createdAt, errorText }, last, today, known);

test("Nedarim dates use day first and reject impossible dates", () => {
  assert.equal(nedarimDate("05/11/2026 00:00:00"), "2026-11-05");
  assert.equal(nedarimDate("5.11.2026, 0:00:00"), "2026-11-05");
  assert.equal(nedarimDate("31/02/2026"), "");
});

test("a recent successful charge prevents a routine decline alert", () => {
  assert.equal(health("2026-10-17", "2026-11-17", "אין כיסוי").status, "active");
});

test("stale mandates surface even when the provider is silent", () => {
  assert.equal(health("2026-09-17", "2026-11-16").status, "active");
  assert.equal(health("2026-09-17", "2026-11-17").status, "issues");
  assert.equal(health("2026-12-31", "2027-02-28").status, "issues");
  assert.equal(health("", "2026-11-17").status, "issues");
  assert.equal(health("", "2026-11-17", "", true, "04/11/2026").status, "active");
});

test("unavailable history is not a missed charge; blocked or stolen cards are urgent regardless", () => {
  assert.equal(health("", "2026-11-17", "", false).status, "active");
  for (const error of ["כרטיס חסום", "הכרטיס דווח כגנוב", "stolen_card"]) {
    assert.equal(health("", "2026-11-17", error, false).issueKind, "card_requires_action");
  }
});

test("declines and missing approvals cannot count as successful Nedarim charges", () => {
  for (const approval of ["", "0000", "סירוב"]) {
    assert.equal(isConfirmedNedarimCharge({ 'מספר אישור': approval }), false);
  }
  assert.equal(isConfirmedNedarimCharge({ 'מספר אישור': "12345", "סטטוס עסקה": "סורב" }), false);
  assert.equal(isConfirmedNedarimCharge({ 'מספר אישור': "12345" }), true);
});

test("completed mandates stay completed even when historical charges are missing", () => {
  const result = nedarimMandateHealth({
    status: "completed", issueKind: "no_remaining_payments",
    createdAt: "04/01/2025", errorText: "כרטיס חסום"
  }, "", "2026-11-18", true);
  assert.equal(result.status, "completed");
  assert.equal(result.issueKind, "no_remaining_payments");
});
