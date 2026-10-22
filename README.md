# PillarSpec WhatsApp receiver

Receives messages and delivery statuses for +96178701617. It does not send automatic replies or connect an AI model. No paid API dependencies are required.

## Run

1. Install Node.js 24 or newer.
2. Copy `.env.example` to `.env` and fill the three secret values. Keep `.env` private.
3. `META_APP_SECRET` is the App Secret from Meta app **Business Messaging Assistant** (1112787251681169). It is not an access token.
4. Generate separate random `WEBHOOK_VERIFY_TOKEN` and `INBOX_API_TOKEN` values, each at least 32 characters. Use your host's secret settings in production.
5. Run `npm test`, then `npm start`.

The default listener is http://127.0.0.1:3000. Local operation alone does not make it reachable by Meta.

## Deploy

Use one always-on Node 24 service or the supplied Dockerfile, behind a host-managed HTTPS endpoint. Set `HOST=0.0.0.0` on container hosts. Attach a persistent disk at `/app/data` for Docker, or set `DB_PATH` to a persistent writable location. Run a single instance with this SQLite store; scaling requires a shared database or queue. Keep the database and backups private and encrypted using your hosting provider's disk controls.

Required host secrets: `META_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`, `INBOX_API_TOKEN`.
Set `ALLOWED_PHONE_NUMBER_ID=1367620946438403` and `RETENTION_DAYS=30`.
Health check: `GET /healthz`.

After hosting is live, configure Meta's callback URL as `https://YOUR-HOST/webhooks/whatsapp`, with the matching verification token, and subscribe to the `messages` field. The app's account subscription has already been added. App publication and any required billing setup remain separate Meta steps. Verify using a new incoming message after setup; old messages are not replayed.

## Private inbox

`GET /api/events?after=0` with header `Authorization: Bearer YOUR_INBOX_API_TOKEN` returns up to 100 saved events. Use the returned `next_cursor` as `after` on the next request. Never put this token in a URL or a public page. Incoming message text and status data are saved; media files are not downloaded. Expired events are removed hourly after 30 days by default. Limit access and arrange backups appropriate to your business.

The public webhook accepts only requests signed with the Meta app secret and only stores events for the configured phone number. Invalid requests are rejected; duplicate events are ignored. No message contents or secrets are printed in application logs.

## Still needed

An actual hosting destination and its secret configuration are needed before this can be connected to Meta. No public receiver URL has been deployed by this package.
