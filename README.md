# P1027 Admin — WhatsApp feed

Agent SDK bot (**P1027 Admin**) that reads workplace **WhatsApp** lunch orders (and monthly leave), prices them, and upserts into Firestore for the P1027 Admin food/leave web app.

- Deploy / package slug: `whatsapp-food-feed`
- Firebase **projectId**: `roy-console` (technical id — keep as-is)

## What it does

- Reads/search WhatsApp via Cursor account MCP (**Automata WhatsApp**); send is disabled.
- Prices: meal **$50**, soup free, drink **+$5**; off-menu → amount **0**.
- Upserts Firestore `orders`, `weeklyReports`, `leaveRequests`.
- Schedules: **Friday 17:00 Asia/Hong_Kong** weekly summary; **1st of month** leave ingest.

Default food chat: **P1027 Admin Group** (`85297868213-1620171799@g.us`).

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
| `FIREBASE_SERVICE_ACCOUNT_JSON` | for live writes | Full Firebase **service account** JSON (Admin). Never commit. |
| `FIREBASE_PROJECT_ID` | optional | Defaults to `roy-console`. |
| `FIRESTORE_DRY_RUN` | optional | Set `1` to force sample-file writes only. |

Without the service account, tools still run and append sample documents to:

`/cursor/stores/self/internal/sample-firestore-payload.json`

### Create the service account

1. Firebase console → project **roy-console** → Project settings → Service accounts.
2. Generate a new private key (JSON).
3. Locally: `export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat ./sa.json)"` (keep `sa.json` out of git).
4. Hosted: after deploy,

```bash
printf %s "$(cat ./sa.json)" | npx --yes "@grok/agent-sdk@0.7.3" secret set whatsapp-food-feed FIREBASE_SERVICE_ACCOUNT_JSON
```

Also enable the **Cloud Firestore** API and ensure the service account can write the collections below.

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
