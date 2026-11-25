# QQ Music mobile authorization

The mobile button opens the official authorization page for the **current QR challenge**. Opening QQ Music is not treated as a successful connection. The original challenge is polled until the backend returns `connected`.

## Public source evidence

Checked on 2026-11-25:

- The official [QQ Music AASA](https://music.qq.com/.well-known/apple-app-site-association) associates the QQ Music iOS apps with `/unilink/*`.
- The official [mobile SDK](https://y.qq.com/lib/commercial/h5/music-react-2.3.0.min.js) constructs app links using `ui/openUrl`, an encoded JSON `p` parameter containing the target `url`, and `_from_outside: "1"`. Its Safari path wraps the app scheme in `https://music.qq.com/unilink/download.html?scheme=…`. Relevant functions in the checked version: `io` around character 91750, `Jo` around 123386, and `M` around 124791.
- The live QR short link was followed in an isolated, unauthenticated test. It redirects to `https://y.qq.com/m/client/qr_code_login/authorize.html`, with the challenge in `qrcode_id`. No live QR identifier or token belongs in documentation or logs.
- The official [authorization page script](https://y.qq.com/m/client/qr_code_login/authorize.8139bd67b.js) reads that query parameter around character 37818 and selects the QQ Music context when running inside the app. The confirmation path around 41579 preserves the same challenge identifier.
- The official [shared script](https://y.qq.com/m/client/qr_code_login/img/common.bundle.1a5e78c66.js) loads the challenge using `GetQRCodeStatus`, then submits user confirmation using `QRCodeLogin` with that challenge and the platform-issued confirmation token. Its generic unsupported-browser button only opens the app's account tab; that fallback is **not** used as authorization here.

These are public implementation details, not a claim that Tencent provides this project with an official third-party OAuth integration or commercial permission.

## Frontend behavior

- On phones, QQ connecting first attempts the validated app scheme after creating a real challenge. An explicit tap on the Universal Link is also available if the browser blocks that attempt. The report page remains available for fallback. NetEase shows its QR first because its verified app route opens a scanner rather than a request-bound authorization screen.
- QR is initially collapsed on phones. If the browser stays visible for 3.5 seconds, the launch throws, a polling request fails, or the user returns without authorization, the same QR is revealed. Users can reveal it immediately. Desktop keeps the QR visible.
- The frontend accepts only the expected official host/path, nested app method, authorization page, and a nonempty challenge parameter. It also requires the link expiry to match the QR expiry.
- The app button never creates another QR. It sets an opening/pending UI state only.
- Returning through `pageshow` or `visibilitychange`, or pressing the explicit check button, checks the existing QR. Switching to the app does not cancel it.
- Expired challenges cannot launch the app. Unavailable/invalid links retain the QR fallback and display a specific error when supplied.
- Missing app confirmation never changes the account to connected. If the app did not visibly open, the UI keeps a retry/check action and QR fallback.
- The same `Connections` component can render embedded or in a modal; the history portal target stays stable across that change.

## iPhone verification

Apple documents that tapping a Universal Link and entering it in the address bar are different actions. Same-domain navigation may remain in Safari, user choices can affect handling, and other browsers may behave differently. See [Apple's Universal Link troubleshooting](https://developer.apple.com/documentation/technotes/tn3155-debugging-universal-links).

On 2026-11-25, the user reported successful QQ Music authorization on an iPhone, and confirmed NetEase opens its scanner. Automatic return to the browser is not supported by a verified callback: the checked QQ authorization bundle closes its own webview on the success button and does not consume an arbitrary website return URL. The website now explains the system return-to-browser affordance or app switcher, checks the existing challenge on return, and stays in platform selection until the user presses Continue. No automatic cross-app return is claimed.

Acceptance cases: successful confirmation; cancellation in QQ Music; no app installed; expired challenge; return without confirming; network interruption; Safari versus an embedded browser. No device success is claimed before those checks.

Frontend unit coverage checks accepted/rejected link targets, missing metadata, expiry/state gating, and safe error-code handling. The isolated UI fixture under `work/mobile-auth-ui` uses simulated responses only and must not be confused with a real-device authorization test.

## NetEase scanner handoff

The official [NetEase mobile bundle](https://s3.music.126.net/mobile-new/app.8330d360.js), fetched from the script referenced by its mobile login page on 2026-11-25, exposes `orpheus://scancode`. Its [AASA](https://music.163.com/.well-known/apple-app-site-association) lists `/m/applink/`, and the mobile bundle constructs that Universal Link with an encoded `scheme` parameter. These support a scanner handoff only: no request-bound direct authorization scheme has been verified. The user confirmed this scanner destination on their iPhone.

NetEase now presents the QR to save before the explicit “Open NetEase scanner” action. Its instructions describe photo-library recognition or scanning from another screen. Opening this entry is never reported as an authorized account, and same-phone image recognition still needs device testing.
