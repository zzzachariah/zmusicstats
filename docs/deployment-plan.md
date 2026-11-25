# Local-first deployment

Updated 2026-11-25. The user approved a local-first website with a minimal relay. This replaces the earlier proposal to keep reports in cloud storage and run history imports as cloud workflows.

## Data placement

- The React/Vite website is static. Report analysis, music portraits, time comparisons, charts, and PNG export run in the browser without an AI service.
- Real monthly reports and public track metadata are saved in this browser's IndexedDB, separated by platform and account scope. A saved-report entry allows viewing these reports without a live platform session. Clearing website data removes local reports; they are not backed up to a cloud database.
- Same-origin Vercel Node Functions relay the allowed NetEase and QQ calls and Apple Music authorization. Credentials never appear in URLs, frontend configuration, logs, or report exports.
- One **private Blob store** holds AES-GCM-encrypted login sessions, QR state/events, and short-lived rate-limit counters only. No monthly reports, play counts, poster files, or history queues are written there.
- Sessions expire after 12 hours. QR sessions expire after three minutes. Every read enforces expiry; one-day Blob TTL removes expired records later. Production and preview have separate encryption keys and storage namespaces.
- Mutations use conditional ETag writes. Disconnect/replacement invalidates pending authorizations and reads. A late request cannot restore a disconnected account.
- Apple private keys are server-only secrets. Developer tokens are signed on demand and include the website origin. Apple Music subscriber authorization and the data Apple's API actually exposes still need to be tested with an eligible account.

## History and refresh

The browser discovers the account's available closed months, reads individual months with progress, and persists successes locally. Closing the tab pauses further requests; returning users can continue without downloading successful months again. Partial results remain retryable. Account changes never reuse another account's reports. Current-month Apple/recent data has short cache freshness and is not represented as dated all-time history.

Cloud Functions execute only bounded requests. There is no Workflow, Supabase database, or unattended full-history import. A QQ Music QR requires a short MQTT-over-WebSocket listener; `waitUntil` keeps it alive for its bounded QR lifetime, and other instances read the encrypted ordered event list. The listener subscribes before the QR is shown, checks for cancellation, and expires automatically. Actual cloud QQ relay reliability is a release check, not an assumption based on local success.

## Configuration

Server-only: `CLOUD_SESSION_SECRET` (32 random bytes encoded base64url), `QQ_SESSION_SECRET`, `APPLE_MUSIC_TEAM_ID`, `APPLE_MUSIC_KEY_ID`, `APPLE_MUSIC_PRIVATE_KEY`, and the private store's injected credentials. Never use VITE_ prefixes for these. Never upload the developer's `.env`, `.p8`, `.auth-state`, `work/` or personal listening reports.

Build with `ZMUSICSTATS_CLOUD=true`; `/api/*` uses `api/[...path].mjs`. The local development launcher remains available and retains its existing local encrypted-file behavior.

## Release validation

Run the existing tests plus cloud account-isolation, encryption/expiry/CAS, disconnect-race, and browser monthly-cache tests. Check desktop and mobile layouts, real cloud QR creation, confirmation, account identity, month-specific reports, page refresh and interrupted imports. An actual user scan is required to claim live login/history verification. Apple subscription access and iPhone same-device return are separate acceptance checks.
