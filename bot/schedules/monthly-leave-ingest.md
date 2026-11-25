---
cron: "0 1 1 * *"
---

It is the 1st of the month ~09:00 Asia/Hong_Kong (cron 01:00 UTC).

1. Search WhatsApp for leave-related messages (請假, leave, AL, 年假, 病假), preferring the locked food/admin chat **P1027 Admin Group** (`85297868213-1620171799@g.us` / `FOOD_CHAT`).
2. Parse each clear leave application into person, month (YYYY-MM), dates[], type (`annual`/`sick`), optional halfDay (`AM`/`PM`), note.
3. Call `upsert_leave_records` → Firestore `leaveRequests` (Spark: needs `FIREBASE_WRITE_TOKEN`; dryRun only if testing without credentials).
4. Reply in summary style for the operator:
   - **Annual leave (AL):** bullets like `3 Nov — Daniel`, `4 Nov, PM — Name`, `2–4 Nov — Name`
   - **Sick leave (SL):** same bullet format
5. Web board at https://sick-meal.web.app mirrors that AL/SL layout.
