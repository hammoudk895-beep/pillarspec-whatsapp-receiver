# PillarSpec dual-mode release — 23 October 2026

The owner chose to extend the active Fly application `pillarspec-whatsapp-agent`.
Meta currently routes the production number +961 78 701 617 to that application.
The existing Render receiver is retained as the legacy receiver; its callback was not changed.

## Verified behavior

- Customer mode: Arabic/English/French intake and eight approved service descriptions. Quotes, commitments, sensitive questions and uncertainty remain subject to human approval.
- Private Jarvis mode: only the owner number explicitly authorized in this session. Identity is the sender in a Meta-signed webhook, additionally restricted by account and destination-phone checks. A number typed inside message text cannot confer access.
- Owner requests, replies and short conversation history are stored in `owner.sqlite3`, separately from customer storage, and are absent from customer review APIs. The model has web research access but no customer database, shell, production-management or outbound-business-action tools.
- Owner replies go only to the configured owner, within the WhatsApp reply window. Ambiguous/uncertain sends are never automatically retried. Owner records have 30-day retention; message-ID hashes remain for replay rejection. Protect the owner's WhatsApp account; this release does not add a second authentication factor.
- Fixed a malformed inbound timestamp rejecting the entire customer webhook batch.

## Validation

35 local tests pass. Six owner isolation/lifecycle tests also pass against the deployed code in a temporary database. Deployed code hashes match local source. Live web research returned an HTTPS source; isolated remote workflow used stub transport and sent no real messages.

The owner's real WhatsApp test reached the private queue, generated one reply with an HTTPS source and received a signed Meta delivered status. Its wording differed from the suggested NASA/Mars prompt. Existing customer inbox/outbox counts stayed unchanged: four historical customer replies remain sent/delivered.

Deployment image: `sha256:f85c8d971ab4274a2d4b3db3b11adb6ca9b15e54a2b9d73fce7b931a5462a043`.
Evidence is retained locally in `outputs/dual-mode-remote-evidence.json`, `outputs/fly-operations-current.json` and `outputs/setup-current-evidence.json`; no customer texts or credential values are included.

## Catalogue publication blocker

All eight supplied images and descriptions are packaged; all eight descriptions are loaded in the assistant. Meta catalogue publication is NOT complete. Existing token: catalogue/products HTTP 400 code 100/subcode 33; account association HTTP 403 code 200. Fresh Commerce Manager retry redirects through `permissions_needed` and fails with `ERR_TOO_MANY_REDIRECTS`. Restore authorized Commerce Manager access before publication; do not invent prices or broaden permissions speculatively.

## Source archive

`pillarspec-dual-mode-source.zip` contains the reproducible Fly application source, tests, deployment configuration, operating notes, approved catalogue descriptions and artwork manifest. The eight original images remain in the local `catalogue/artwork` folder; they are not required to build the application image. The archive contains no populated environment files, private database, customer records, host tokens or API keys. It preserves the Fly application's directory structure without replacing the legacy Render receiver's root Dockerfile.

Extract the archive into a clean folder, provide existing host secrets through the hosting provider, run `python -m unittest -v`, and use the included Fly configuration for this single-instance application. Do not deploy it over the legacy Render service without deliberately migrating its secret names, health endpoint and persistent-state layout.
