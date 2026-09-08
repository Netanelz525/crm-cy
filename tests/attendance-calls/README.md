# Attendance call teams

Managers open an attendance session and expand **צוות מתקשרים למפגש** to select responsible students. Each student signs in with the account linked to their student card and opens **אזור השיחות שלי → שיחות למפגשים**. Managers can also enter the queue. No caller is assigned automatically when this feature is deployed.

A caller receives one invitee per session, exclusively for five minutes. Reopening the queue (including another account linked to the same caller student) reuses the lease without extending it. An expired token cannot save changes. The queue derives eligible invitees from the session's current roster, not the legacy graduate assignments.

- **טופל** records the call and removes the invitee from that session's queue. An optional attendance status updates the session's attendance record.
- **דחה** releases immediately and retries after five minutes.
- **לא ענה** releases immediately and retries after fifteen minutes. It does not change attendance.
- All three actions request the next available invitee. If none are available, the caller can retry later.
- Removing a caller releases their lease. Locked sessions and unapproved accounts cannot operate the queue.

The manager panel shows completion counts and the latest 100 call attempts. The assigned caller sees only the current invitee's name, class, phone, attendance status and last five call attempts. Full student cards and the complete roster are not exposed by the new queue API. Calls are made by the user's telephone application via a `tel:` link; no automatic dialing or messages are sent.

Three additive tables are initialized on first use. Schema setup uses a transaction-scoped advisory lock. Queue mutations use a single Neon HTTP transaction, lock the session row, and run subsequent statements at READ COMMITTED. A partial unique index also enforces one active lease per caller per session. Completion, attendance update and contact log are atomic and lease-token retries are idempotent.

## Regression tests

Run `npm install --prefix tests/attendance-calls`, then `npm test --prefix tests/attendance-calls`.

These tests execute the production SQL in PGlite (embedded PostgreSQL) with isolated synthetic users and rosters. They cover concurrent requests, lease reuse/expiry, caller identity, authorization, team removal, session locks, roster removal, status validation, retry delays, idempotency and rollback. PGlite serializes transactions; multi-connection lock scheduling on hosted Neon is not a load test in this suite.
