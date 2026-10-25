# PillarSpec 2.0.0 deployment record — 25 October 2026

## Verified during this work

- [x] Existing live deployment and repository identified.
- [x] Public `/healthz` returns HTTP 200 with service `PillarSpec WhatsApp agent` and version `2.0.0`.
- [x] Meta's read-only checks confirm registered business number, published app, configured callback, account subscription and payment setup.
- [x] Current receiver package and previous upgrade inspected.
- [x] Private Jarvis research support, local notes/tasks, isolated conversation context, error diagnostics and delivery handling implemented.
- [x] All 28 tests pass locally and in Render's Docker verification stage.
- [x] GitHub browser access restored; the complete release committed to `main` as `348a438e1c4f3c89d5eb3745853686a6f9601bcc`.
- [x] Render deployment `dep-dbetv6os76nc739epp90` reached `live` for that source commit.
- [x] `/api/agent/status` now exists and rejects unauthenticated requests with HTTP 401.

## Completion gates still requiring live evidence

- [ ] Existing Meta secrets preserved; messaging token and OpenAI credentials verified securely.
- [ ] AI model access and a bounded paid AI request succeed.
- [ ] Runtime auto-reply, outbound, AI and research switches enabled intentionally.
- [ ] A fresh owner message produces a delivered reply on WhatsApp.
- [ ] Owner research yields current clickable sources; customer isolation verified with another sender.

## Access observations

The GitHub browser session can access and update the private repository. The separate GitHub connection still lists zero installed accounts/repositories and its repository lookup returns 404.

The existing Render connection can inspect deployment state and logs. Render dashboard sign-in was declined. Stored runtime credential values, AI model access, current enable switches and the actual WhatsApp reply flow remain unverified. Deployment authorization is already granted; dashboard authentication is needed to inspect the protected configuration and run the remaining live checks.

Meta business verification is not approved in the checked account. The operational onboarding checks pass; no genuine corporate verification documents were invented or submitted. This item is separate from the code deployment failure.
