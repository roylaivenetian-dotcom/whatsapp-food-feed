---
cron: "*/5 * * * *"
---

Process pending Menu admin OCR jobs (Firestore `menuVisionJobs`) for P1027 Admin.

1. Call `list_pending_menu_vision_jobs` (limit 3).
2. For each job with an `imageDataUrl`:
   - Call `complete_menu_vision_job` with status `running`.
   - Use **vision** on the menu photo (weekly 繁體中文 Mon–Sat / 星期一–六 grid). Read strokes carefully (韭菜花≠九菜, 芥蘭≠介蘭, 蘿蔔≠羅白, 炆/豉/燒).
   - Call `complete_menu_vision_job` with status `done` and dishes like:
     `[{nameZh, weekday:"mon"|"tue"|"wed"|"thu"|"fri"|"sat", nameEn:"", category:"meal"}, …]`
   - **Every day column** gets its own rows. Do **not** collapse the week into ~30 unique names — expect ~40–55 rows (~43 unique names). Dedupe only identical `nameZh`+`weekday`.
   - On failure, call `complete_menu_vision_job` with status `error` and a short error string.
3. Do **not** use Tesseract or Gemini. Do **not** send WhatsApp messages.
4. Food chat context (orders) remains **P1027 Admin Group** `85297868213-1620171799@g.us` — this schedule is only for Menu OCR jobs from https://sick-meal.web.app.
5. Reply with job ids processed and dish counts.
