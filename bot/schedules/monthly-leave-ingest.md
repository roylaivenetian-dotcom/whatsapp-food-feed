---
cron: "0 1 1 * *"
---

It is the 1st of the month ~09:00 Asia/Hong_Kong (cron 01:00 UTC).

1. Search WhatsApp for leave-related messages (請假, leave, AL, 年假, 病假) in the workplace groups, especially **P1027 Admin Group** (`85297868213-1620171799@g.us`).
2. Parse each clear leave application into person, month (YYYY-MM), optional dates, type, note.
3. Call `upsert_leave_records` (use dryRun only if credentials are missing and you are testing).
4. Reply with a short list of leave records ingested for this month.
