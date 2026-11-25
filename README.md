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

## Secrets / write path

| Name | Required | Purpose |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | preferred | Admin SDK / REST writes. Org policy may block key creation. |
| `FIREBASE_INGEST_KEY` | preferred fallback | Same value as Functions secret `INGEST_API_KEY`; sent as `x-ingest-key`. |
| `FIREBASE_INGEST_URL` | optional | Default `https://asia-east2-sick-meal.cloudfunctions.net/api` (also Hosting `/api/**`). |
| `FIREBASE_PROJECT_ID` | optional | Defaults to `sick-meal`. |
| `FIRESTORE_DRY_RUN` | optional | Set `1` to force sample-file writes only. |

**Order of preference:** Admin SA → HTTP ingest → local sample file  
(`/cursor/stores/self/internal/sample-firestore-payload.json`).

Local fallback for the ingest key (dev VM only): `/cursor/stores/self/internal/ingest-key.txt` — **never commit** that file into this repo.

HTTP body actions (sibling Function `api`): `upsertOrder`, `createLeave`.

### HTTP ingest (recommended when SA keys are org-blocked)

1. Deploy Functions on **sick-meal** (`api` + secret `INGEST_API_KEY`) from `p1027-admin`.
2. Set the same key on this agent:

```bash
printf %s "$(cat /cursor/stores/self/internal/ingest-key.txt)" | \
  npx --yes "@grok/agent-sdk@0.7.3" secret set whatsapp-food-feed FIREBASE_INGEST_KEY
# optional:
# printf %s 'https://asia-east2-sick-meal.cloudfunctions.net/api' | \
#   npx --yes "@grok/agent-sdk@0.7.3" secret set whatsapp-food-feed FIREBASE_INGEST_URL
```

### Service account (optional if ingest works)

Org policy may block key creation. If allowed: Firebase Console → **sick-meal** → Service accounts → Generate key → set `FIREBASE_SERVICE_ACCOUNT_JSON` the same way. Never commit the JSON.

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
