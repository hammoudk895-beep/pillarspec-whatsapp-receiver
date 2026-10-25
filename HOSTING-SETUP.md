# PillarSpec existing-service deployment

Follow README.md and LAUNCH-CHECKLIST.md. This upgrade belongs on the existing repository's main branch and the existing Render service. Preserve existing receiver credentials and the persistent disk. Runtime AI and messaging credentials must be configured in the hosting service, never committed.

The upgrade is committed to `main` as `348a438e1c4f3c89d5eb3745853686a6f9601bcc` and is live on Render deployment `dep-dbetv6os76nc739epp90`. All 28 tests passed in the container build; public health reports version `2.0.0`. Runtime credentials, enable switches and an actual WhatsApp exchange still require protected configuration access and live verification. See LAUNCH-CHECKLIST.md and VALIDATION.md for the recorded evidence and remaining checks.
