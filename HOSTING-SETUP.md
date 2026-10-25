# PillarSpec existing-service deployment

Follow README.md and LAUNCH-CHECKLIST.md. This upgrade belongs on the existing repository's main branch and the existing Render service. Preserve existing receiver credentials and the persistent disk. Runtime AI and messaging credentials must be configured in the hosting service, never committed.

The last observed live source commit was `92d6668bc46f91ac2263e2058b4b3f4f8c4a0bd1`. It is receiver-only and does not contain this upgrade. Rebuilding that same commit will not add AI or Jarvis. Source access and credential verification are required before deployment can be completed.
