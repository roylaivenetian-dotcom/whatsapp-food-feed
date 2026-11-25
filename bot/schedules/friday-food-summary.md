---
cron: "0 9 * * 5"
---

It is Friday 17:00 Asia/Hong_Kong (this cron is 09:00 UTC).

1. Use WhatsApp MCP (`list-chats` / `search-messages` / `read-messages`) on the food-order chat (default jid `85297868213-1620171799@g.us`, name **P1027 Admin Group** unless the operator set another).
2. Collect this Mon–Fri week's lunch orders. Message timestamps are UTC; convert order **date** to Asia/Hong_Kong YYYY-MM-DD.
3. For each person/date line, call `normalize_food_order` or batch via `upsert_food_orders` (meal $50, soup free, drink +$5; off-menu amount 0).
4. Call `prepare_weekly_report` with those orders so `weeklyReports` is ready for the web app.
5. Reply with a short Cantonese+English summary: per-person totals and grand total. Note dry-run / missing credentials if Firestore did not write live.
