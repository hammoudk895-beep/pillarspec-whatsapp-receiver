# New hosting account: Render

Prepared configuration only: no account, subscription, public endpoint or charge has been created.

1. Create an account at https://dashboard.render.com/register and complete its sign-in steps.
2. Create a private GitHub repository containing this folder's contents at its root. Do not upload `.env` or a database. Connect that repository to Render with access limited to this repository.
3. In Render choose **New > Blueprint**, select the repository, and review `render.yaml`. It provisions one Docker web service and a 1 GB persistent disk. This requires paid hosting; review the current service and disk charges before deployment.
4. Supply `META_APP_SECRET` directly in Render's secret field using the App Secret from Meta's **Business Messaging Assistant** app. Render generates the other two tokens. Do not paste your App Secret into chat or commit it to GitHub.
5. Deploy after approving the charges. Confirm the service is healthy using its actual assigned HTTPS URL followed by `/healthz`.
6. Copy the actual URL followed by `/webhooks/whatsapp` into Meta's webhook configuration. Use the generated `WEBHOOK_VERIFY_TOKEN` from Render. Subscribe to the `messages` field. Never use the private inbox token as Meta's verification token.
7. Complete Meta's app publication requirements and account billing where required. The app's subscription to PillarSpec's WhatsApp account is already configured.
8. Send a new WhatsApp message to +96178701617. Confirm it appears through the private `/api/events` endpoint with `INBOX_API_TOKEN` in the Authorization header. Confirm it still appears after restarting the service.

Keep the generated inbox token in a password manager. It grants access to customer message data. This receiver does not yet send automatic replies or call an AI model.

Official references:
- https://render.com/docs/blueprint-spec
- https://render.com/docs/disks
- https://render.com/docs/docker

The prepared plan uses Render's current compute-plan identifier `0.5c-512mb`. Check the dashboard's displayed monthly quote rather than assuming a fixed price. Persistent storage is required for this SQLite design; do not change to an ephemeral free service.
