# Cloud deployment assessment

Reviewed: 2026-11-25. This is a deployment plan, not a claim that the live connection backend has been deployed or verified in the cloud. No cloud resources or paid plans were created during this review.

## Decision

Keep real account connections on the local service for now. A public UI preview can use explicitly labelled example data, with music authorization and credential entry disabled. Do not send preview requests to the developer's computer or publish its sessions, history, environment files, or Apple key.

The complete application can be designed to use **one Vercel project, Vercel Private Blob, and Vercel Workflow**, without Supabase or another database provider. This requires backend changes; uploading the present Node servers is not sufficient. The remaining platform-specific uncertainty is the QQ Music App QR relay, which must pass cloud tests without replacing it with ordinary QQ login.

The smallest proposed layout is:

| Component | Placement |
| --- | --- |
| Existing Vite/React UI and browser-generated posters | Static output in one Vercel project |
| Account, QR, report, metadata, and cover endpoints | Node.js Functions in that same project |
| Encrypted sessions, QR state/events, monthly reports, import manifest | One private Blob store, separate keys by environment and session |
| Automatic history discovery, monthly reads, metadata completion | Workflow steps in the same project |
| QQ Music App MQTT listener | A bounded Function/Workflow step with shared QR events; feasibility gate below |

Services is an optional packaging choice if the gateways remain separately built components. It is currently beta, and its services still inherit Function limits. It does not turn local files or Maps into shared durable storage. Calling the packages from the API's server-side code avoids extra gateway projects and localhost processes. See [Services](https://vercel.com/docs/services) and [Services limits](https://vercel.com/docs/services/pricing).

## Why the existing backend needs adaptation

- `scripts/dev.mjs` launches Vite, the API, and two loopback gateway processes. Gateway packages live under Git-ignored `work/`, rather than the deployable root dependencies.
- `server/index.mjs` uses process-local Maps for sessions, QR challenges, cached reports, and request limits. A different Function instance will not see those Maps.
- `server/session-store.mjs` writes all connections to a local AES-GCM file and generates `session.key` locally. Copying this design to `/tmp` would lose connections on replacement and create different keys across instances.
- `server/history-import.mjs` starts `void run(job)` after returning the HTTP response. Jobs are in memory; results are saved to a local encrypted file. A Function response cannot be assumed to keep this work running.
- `server/start-qq.mjs` persists device identity and gateway sessions to local files; the current `qqmusic` channel holds an MQTT connection.
- `server/apple-developer.mjs` signs with a local `.p8` file. Its signing code needs a server-only cloud secret input or a deliberately managed signed token, not the laptop's path.

Functions currently allow 300 seconds on Hobby, with larger limits on higher plans. `waitUntil` only extends work within the same Function deadline; it is not durable execution for an arbitrary number of history months. See [Function limits](https://vercel.com/docs/functions/limitations) and [waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#waituntil).

## Required changes for the Vercel-only version

1. Extract an HTTP request handler from `createApiServer` and add a deployable Node Function entry. Keep the existing local launcher. Use same-origin `/api`, secure cookies, the production/preview origin allowlist, and stable server-side error codes.
2. Install pinned gateway dependencies in the deployable package. Replace loopback fetches with the NetEase library methods and QQ's exported `@yakult-green-tea/qq-music-api/serverless` handler, or private Services with equivalent request handling. Preserve route allowlists and suppression of credential-bearing third-party logs.
3. Introduce asynchronous storage adapters. Store encrypted records per session/provider/month, not one shared whole-process file. Keep the encryption key in server-side environment configuration. Read mutable authorization state with `useCache: false`; update with ETag `ifMatch` and retry conflicts. Bind stored reports and jobs to the connection version so disconnecting/replacing an account invalidates pending work. Never expose the store credentials or upstream music credentials to the browser.
4. Persist QR challenges and job progress so polling can hit different instances. Move expiry and rate limits out of process-local Maps. Enforce the application's expiry on every access; Blob's day-based TTL is only eventual cleanup, not the authorization check. Review the existing gateway QR-key limit of 1024 characters: QQ's sealed serverless QR state can be longer.
5. Replace the history import loop with resumable discovery and per-month Workflow steps, at bounded concurrency. Persist each verified month and completion/error status. Make retries idempotent; check connection version before calls and writes; support cancellation and restarting without rereading completed months. Run metadata enrichment as bounded steps before declaring the report ready.
6. Pass opaque record IDs into Workflow, not raw music credentials. Read/decrypt secrets only inside steps. Store the final report in Blob rather than treating Workflow logs as the permanent database. Finished-run payload access is retention-limited. See [Workflow execution](https://vercel.com/docs/workflows), [retention](https://vercel.com/docs/workflows/retention), [Private Blob consistency](https://vercel.com/docs/vercel-blob/private-storage#consistent-reads), and [conditional writes](https://vercel.com/docs/vercel-blob/using-blob-sdk#put).
7. Paginate bulk historical report responses and metadata requests. Non-streamed Function responses have a 4.5 MB limit. Posters already render in the user's browser, so they do not require an image-generation backend or Blob uploads.
8. Add a server-only Apple signing-key input suitable for cloud deployment; retain the local-file option for development. Configure MusicKit for the final HTTPS origin and test with an actual subscriber. Do not commit or place the `.p8` in public assets/build output.
9. Test two independent instances, cold starts, a deployment during history import, account replacement/disconnect races, QR expiry/cancel, storage errors, and retries. Real NetEase/QQ access from the chosen region and iPhone same-device app return remain cloud/device tests, not assumptions based on local success.

## QQ Music App gate

The installed QQ package 3.3.8 exposes a serverless handler and sealed sessions. Its implementation advertises `qq` and `wechat` without a relay, but **`qqmusic` requires an MQTT relay**. Changing `QQ_QR_CHANNEL=qqmusic` to `qq` would remove the requested QQ Music App authorization path and is not an acceptable deployment shortcut. Source: installed package `dist-esm/src/serverless/qrRuntime.js`, `dist-esm/src/serverless/qrOperations.js`, and its [upstream README](https://github.com/yakult-green-tea/qq-music-api).

For the smallest Vercel-only design, investigate one bounded listener per QR: open the MQTT subscription before reporting readiness, keep it alive for the QR lifetime within a 300-second invocation, persist the complete ordered event list, and let other invocations poll/cancel it. The package provides `QqQrRelay` and an exported MQTT codec. Use a durable launch/lease and idempotency to avoid duplicate subscriptions. Stop on success, cancellation, timeout, or instance shutdown; disclose a recoverable error if the connection is lost. **This is an engineering proposal, not an already verified integration.** A missed push message cannot be reconstructed merely from a cached QR image.

If a bounded listener proves unreliable, a Vercel Daemon can consume relay work, but it still requires externalized state and a work-dispatch mechanism. Daemons accept no inbound HTTP/TCP, cannot be routing/binding targets, have no persistent disk, and run only in production during beta. They are not a drop-in placement for `qq-worker.mjs`. Their ongoing memory usage makes them a poor default for this no-new-spending stage. See [Daemon limits](https://vercel.com/docs/daemons/limits).

## Could one container with a persistent disk be smaller?

Yes, a single long-lived application instance with an explicitly mounted persistent volume would need less refactoring: run the API and gateways together, serve the built UI, and place session/history/device state on the volume. Keep one writer, preserve a stable encryption key, back up the volume, and restart interrupted imports safely. An unmounted container filesystem or `/tmp` is insufficient.

**Vercel Functions, Services, and Daemons do not provide that persistent-volume model.** Instance-local data is temporary. Vercel Drives currently mount into Sandbox, not ordinary Functions/Services/Daemons, so they are not a substitute for this application's disk. See [Vercel's Docker comparison](https://vercel.com/kb/guide/docker-on-vercel-vs-render) and [Drives](https://vercel.com/docs/drives).

A platform such as Render supports an attached persistent disk on paid services; it is a possible future deployment model, not a free resource we should create now. No existing suitable cloud host/volume has been verified for this project. See [Render persistent disks](https://render.com/docs/disks).

## Cost and release boundary

- Do not enable a paid plan, trial, daemon, database integration, or usage overage to make this preview work. The inspected team exists, but the connector response did not establish its billing plan or remaining allowance.
- Blob on Hobby includes 1 GB storage, 10,000 simple and 2,000 advanced operations, and 10 GB transfer. Over limits, Hobby access stops; Pro uses credit then usage-based billing. Mutable session reads and monthly/QR writes consume operations. See [Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing).
- Workflows have their own usage charges, plus the Functions and Queues they invoke. Hobby includes 50,000 events and 1 GB data written. A long history is many steps, so persist results and avoid repeating completed work. See [Workflow pricing](https://vercel.com/docs/workflows/pricing).
- A continuously running minimum-size Daemon consumes memory allowance even while idle. Hobby includes 420 GB-hours per month; one 1 GiB instance exceeds that over a full month. Pro bills active CPU and provisioned memory. This is another reason to avoid an always-on relay before it is necessary. See [Daemon quotas](https://vercel.com/docs/daemons/limits#default-quotas).
- The upstream QQ package README limits use to learning/noncommercial purposes despite its MIT package metadata. Public commercial operation needs separate resolution; a credential-free UI preview does not deploy this gateway.

The immediate release is a labelled static UI preview. Full cloud account connections remain disabled until storage, resumable import, QQ Music App relay, secret configuration, billing boundaries, and real cloud login/data tests are complete.
