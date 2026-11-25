# P1027 Admin — WhatsApp feed

Agent SDK bot (**P1027 Admin**) that reads workplace **WhatsApp** lunch orders (and monthly leave), prices them, and upserts into Firestore for the P1027 Admin food/leave web app.

- Deploy / package slug: `whatsapp-food-feed`
- Firebase **projectId**: `sick-meal` (technical id — not the brand)

## What it does

- Reads/search WhatsApp via Cursor account MCP (**Automata WhatsApp**); send is disabled.
- Prices: meal **$50**, soup free, drink **+$5**; off-menu → amount **0**.
- Upserts Firestore `orders`, `weeklyReports`, `leaveRequests`.
- Schedules: **Friday 17:00 Asia/Hong_Kong** weekly summary; **1st of month** leave ingest.

**Food chat (locked):** **P1027 Admin Group** (`85297868213-1620171799@g.us`) — see `bot/lib/config.ts` `FOOD_CHAT`.

## Local run

```bash
cd /agent/whatsapp-food-feed   # or your clone path
npx --yes "@grok/agent-sdk@0.7.3" login
npx --yes "@grok/agent-sdk@0.7.3" validate --dir .
npx --yes "@grok/agent-sdk@0.7.3" info --dir . --json
npx --yes "@grok/agent-sdk@0.7.3" tool call normalize_food_order --dir . \
  --input '{"person":"Yin","date":"2026-11-25","dish":"枝竹火腩飯加湯"}'
npx --yes "@grok/agent-sdk@0.7.3" dev
# playground: http://127.0.0.1:3000/playground
```

Manual Friday schedule (dev never auto-fires):

```bash
curl -X POST http://127.0.0.1:3000/whatsapp-food-feed/v1/dev/schedules/friday-food-summary
```

## Secrets

| Name | Required | Purpose |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | optional | Full Firebase **service account** JSON (Admin). Org policy may block key creation. |
| `FIREBASE_PROJECT_ID` | optional | Defaults to `sick-meal`. |
| `FIREBASE_INGEST_URL` | **preferred without SA key** | Cloud Function HTTP URL, e.g. `https://us-central1-sick-meal.cloudfunctions.net/api` or `https://sick-meal.web.app/api` |
| `FIREBASE_INGEST_KEY` | with ingest URL | Shared secret; send as header `x-ingest-key`. Same value as Functions `INGEST_API_KEY`. |
| `FIRESTORE_DRY_RUN` | optional | Set `1` to force sample-file writes only. |

### Preferred: HTTP ingest (no downloaded SA key)

When org policy blocks Admin SA key creation, use the web app Cloud Function ingest (Functions default credentials):

1. Upgrade Firebase project **sick-meal** to **Blaze** (required to deploy Cloud Functions).
2. Deploy Function `api` from `/agent/food-leave-app` (see web app README / deploy blockers).
3. Set agent secrets:

```bash
npx --yes "@grok/agent-sdk@0.7.3" secret set whatsapp-food-feed FIREBASE_INGEST_URL
# value: https://us-central1-sick-meal.cloudfunctions.net/api
npx --yes "@grok/agent-sdk@0.7.3" secret set whatsapp-food-feed FIREBASE_INGEST_KEY
# value: same as Functions INGEST_API_KEY (store: /cursor/stores/self/internal/ingest-key.txt)
```

`upsert_food_orders` / leave / weekly report tools POST JSON with header `x-ingest-key`.

### Optional: Admin service account JSON

If SA key download is allowed: set `FIREBASE_SERVICE_ACCOUNT_JSON` instead. Admin path takes precedence over HTTP ingest.

Without either credential path, tools dry-run and append to `/cursor/stores/self/internal/sample-firestore-payload.json`.

## WhatsApp MCP

1. Keep **Automata WhatsApp** connected on the Cursor account that will run/deploy the agent.
2. Connection file: `bot/mcp-connections/account.ts` (`cursorAccount: true`, server `Automata WhatsApp`).
3. On a hosted deploy, attach the same connector under **Deployed Agents**.

## Deploy

```bash
git init && git add . && git commit -m "P1027 Admin WhatsApp feed agent"
# create an empty GitHub repo, then:
git remote add origin git@github.com:<you>/whatsapp-food-feed.git
git push -u origin HEAD

npx --yes "@grok/agent-sdk@0.7.3" validate --dir .
npx --yes "@grok/agent-sdk@0.7.3" deploy --dir . --dry-run
npx --yes "@grok/agent-sdk@0.7.3" deploy --dir .
# save the one-time alias token from the first deploy
```

Shared schema + bot contract: see project doc `food-leave-app.md` next to this agent’s store docs.
