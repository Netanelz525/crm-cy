import test from "node:test";
import assert from "node:assert/strict";
import { buildEmailAgentMessage, extractInboundMessageText } from "../lib/email-agent-message.js";

test("uses the plain-text email body", () => {
  assert.equal(extractInboundMessageText({ text: "מה הכיתה של ראובן?" }), "מה הכיתה של ראובן?");
});

test("converts an HTML-only body into readable text", () => {
  assert.equal(
    extractInboundMessageText({ html: "<p>מה הכיתה של ראובן?</p><p>ומה הטלפון של שמעון?</p>" }),
    "מה הכיתה של ראובן?\nומה הטלפון של שמעון?"
  );
});

test("sends both subject and body to the agent, including multiple students", () => {
  assert.equal(
    buildEmailAgentMessage({
      subject: "בירור תלמידים",
      body: "מה הכיתה של ראובן כהן? ומה הטלפון של שמעון לוי?"
    }),
    "הודעת מייל שהתקבלה:\n--- נושא ---\nבירור תלמידים\n--- גוף ההודעה ---\nמה הכיתה של ראובן כהן? ומה הטלפון של שמעון לוי?\n--- סוף הודעה ---"
  );
});
