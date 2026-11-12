# CRM CY for iPhone

The SwiftUI app in `ios/CRM` uses the existing CRM deployment, data and authorization. It does not contain a database connection string, API master token or Clerk secret. Minimum iOS version: 17.0. Bundle identifiers: `il.co.yeshivatcy.crm` and `il.co.yeshivatcy.crm.share`. App Group: `group.il.co.yeshivatcy.crm`.

## Main workflows

- Native bottom navigation to attendance, students, tasks and account.
- Google/Clerk authentication in `ASWebAuthenticationSession`, followed by a short-lived, one-time PKCE exchange into the app's WebKit session. The deployed web routes in this commit are required before first login.
- Existing attendance and student card pages, with mobile touch targets and visible attendance save results. Writes for a student are serialized; failed writes remain visible and have an explicit retry button. Attendance is not available offline; leaving the app before retrying a failed save can lose that local change.
- Native file downloads present the iOS share sheet.
- Share extension receives one file/image up to 10MB or plain text up to 100KB. The user selects printing, student association or a template, then opens CRM CY to complete the workflow. iOS share extensions do not automatically launch their containing app.
- Printing reuses the existing chunked upload, print plans, credit checks and permission checks. Student documents support PDF/PNG/JPEG/WEBP up to 3MB in this mobile endpoint (within Vercel's request limit). Shared text is inserted only into an explicitly selected template field. Existing field limits and template permissions still apply.
- Pending shares stay in the protected App Group until successful file upload, explicit removal, or cleanup on a later launch after 24 hours. A share does not itself upload or print anything. Shared text is retained until explicit removal; template generation can be retried.

## Build

Open `ios/CRM/CRM.xcodeproj`, select the `CRMCY` scheme and an iPhone simulator.

```sh
xcodebuild -project ios/CRM/CRM.xcodeproj -scheme CRMCY \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

For distribution, create an unsigned Release archive and export with the Apple Distribution certificate in the **nz** keychain. Explicitly set `signingCertificate` in ExportOptions; automatic archive signing otherwise selects Apple Development. No signing key is stored in the repository.

## Server security checks

`node --experimental-vm-modules --test tests/mobile-auth.test.mjs` exercises one-time redemption, expiry, verifier binding, foreign-origin rejection and Clerk ticket lifetime. Normal RBAC remains enforced by all data routes. Redeem tickets last 30 seconds, exchange codes two minutes. Code values are hashed in Postgres and deleted atomically when redeemed. No auth verifier is put into a URL or persisted on the device.

## Device acceptance before inviting testers

1. Complete Google authentication and verify that attendance and student access match the website.
2. Change attendance, confirm Saved, then verify the same record in a second client. Interrupt connectivity and check Failed/Retry without losing the visible edit.
3. Open a student card and return using the native back control/gesture.
4. Share a PDF or image from Files; open CRM, select a student, and confirm the document is in the intended card.
5. Share a file for printing; verify copies/plan, confirm once, and check the existing print queue. Use an explicitly chosen test document.
6. Share Hebrew multiline text; choose a template and destination field, preview the populated field, then generate/download a test PDF.
7. Exercise download/share, cancellation, expired login, app termination and pending share cleanup.

Actual production printing, student document uploads and template output are not performed by automated tests.
