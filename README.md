# PillarSpec WhatsApp Agent / Private Jarvis — 2.0.0

Business number: **+96178701617**. Private owner number: **+96176868315**.

This is the executable upgrade of the existing Node 24 / SQLite receiver. It is not evidence of a production deployment. The version returned by `/healthz` and a real WhatsApp round trip establish which code is running and whether it works.

## Implemented capabilities

- Customer assistant in English and Arabic, with separate context per sender, enquiry intake, USD-only instructions, and formal commercial commitments left to human review.
- Private Jarvis available only to the owner identified by a Meta-signed incoming event. Research uses OpenAI web search with clickable sources. Local note/task tools work without AI.
- Durable incoming events and outgoing queue, message deduplication, request limits, daily AI-request cap, graceful shutdown and additive database migration.
- Outgoing API acceptance is tracked separately from sent, delivered, read and failed receipts. Ambiguous sends are marked for review rather than automatically duplicated.
- Protected operational status identifies the build, active capabilities, queue counts, delivery receipts and fixed AI-failure categories. Payloads, API keys and phone numbers are never written to runtime diagnostics.

## Owner commands

| Command | Action |
| --- | --- |
| `/help` | Show available commands |
| `/status` | Show actual configured capabilities |
| `/remember text` | Save a private note |
| `/notes keyword` | Search saved notes |
| `/task text` | Save a task |
| `/tasks` | List open tasks |
| `/done id` | Mark a task complete |

With AI enabled, the owner can use natural language for analysis, drafting, research and note/task requests. Tasks are a saved list; saving one does **not** schedule a proactive notification.

## Run and verify

Use Node 24 or newer. No npm package dependencies are required.

```bash
npm test
cp .env.example .env
# Populate .env securely; never commit it.
npm start
npm run doctor
npm run doctor -- --live-ai
```

The last command makes one bounded, paid AI check. Doctor does not send WhatsApp messages and always reports the WhatsApp round trip as unverified. A successful doctor cannot substitute for an actual incoming WhatsApp message and the resulting delivered reply.

`OPENAI_MODEL` is required and must be available to the configured project. The example names `gpt-6-astra`, matching the official web-search example consulted on 25 October 2026; live model access must be checked. AI is disabled unless all required runtime settings are present and enabled. Each provider request, including tool continuation rounds, counts toward `MAX_AI_CALLS_PER_DAY` (default 300, reset at UTC midnight). The count limits requests, not a precise dollar spend.

## Existing deployment

- Repository: `hammoudk895-beep/pillarspec-whatsapp-receiver`, branch `main`.
- Render workspace: `PillarSpec`.
- Service: `pillarspec-whatsapp-receiver` / `srv-dbd1s7bncjis73e071r0`.
- Persistent database: `/app/data/events.sqlite` on the existing disk. Preserve it.
- Public callback path: `/webhooks/whatsapp`; health check: `/healthz`.
- Expected sender phone-number identifier: `1367620946438403` (verified by the connected Meta account).

Use the existing service; do not onboard another business number. Update the code atomically on `main`. The Docker verification stage runs the tests before creating the runtime image. Render auto-deploys commits on `main`; do not trigger a second deploy unnecessarily. The attached disk causes a deployment interruption.

Keep existing `META_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN` and `INBOX_API_TOKEN`. Configure a valid `WHATSAPP_ACCESS_TOKEN`, `OPENAI_API_KEY`, accessible `OPENAI_MODEL`, and owner number in protected hosting settings. Never place secret values in GitHub, screenshots, chat, ZIP files or shell output.

After credential checks, set `OUTBOUND_ENABLED=true`, `AUTO_REPLY_ENABLED=true`, `AI_ENABLED=true` and `RESEARCH_ENABLED=true`. Runtime switches use `sync:false` in the Blueprint, so subsequent Blueprint syncs preserve the service's selected values.

## Acceptance

1. The new deploy reaches `live` and public `/healthz` reports `2.0.0`.
2. Authenticated `/api/agent/status` reports AI, auto-replies, research and owner mode enabled.
3. Send a fresh message from the owner number to the business number; verify both receipt in the private event inbox and the reply's delivered/read receipt.
4. Verify an owner research request returns current sourced results and `/remember` + `/notes` persist across a restart.
5. Verify a separate customer number receives a business reply and cannot retrieve owner data.
6. Confirm no new auth, quota or delivery failures in protected status.

## Actual boundaries

Email, calendar, other WhatsApp chats, ChatGPT history, third-party account actions, proactive notifications, voice transcription and media interpretation are not connected by this code. Customer and owner media messages receive an accurate text-only response. No automatic migration of ChatGPT project memories is implied. Never call the entire project complete based only on the local tests or Meta's onboarding checklist.

Official contracts consulted: [OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search), [function calling](https://developers.openai.com/api/docs/guides/function-calling), [Render environment configuration](https://render.com/docs/configure-environment-variables), [Render deploys](https://render.com/docs/deploys), [health checks](https://render.com/docs/health-checks).
