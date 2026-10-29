# Request Assistance — private, push-first Building Watch workflow

**Status:** feature branch / draft pull request. **No Google Apps Script or Hostinger changes have been deployed.** The published GitHub Pages app still serves `master` until oversight approves and merges this PR.

## Two distinct user groups

**Facilities Team** members sign into Building Watch with an authorized Google account, schedule watch shifts, manage internal assignments, and receive/acknowledge assistance alerts. **Maintenance staff/contractors** do not get an application account. They check in using the admin-managed public Google Form QR code, receive an optional email (with consent), and use its private **Check Out** or **Request Assistance** links. No mobile/telephone numbers are collected or shared by the new interface.

## Alert lifecycle

1. A facilities user selects **Request assistance** and enters a location and message, **or** a maintenance worker selects **Request Assistance** in their check-in email and fills in the same two fields in an authenticated-link form (no Google login).
2. The backend persists an alert to the private `Assistance Alerts` tab in the existing Watch Schedule spreadsheet. GET requests / email link prefetches **never** create alerts; only POST submissions do.
3. All authorized users whose watch shift includes the current time are targeted. For an empty watch shift, the acting building manager is targeted; otherwise the permanent manager. If watchstanders exist but none has a registered push device, the available manager is added as fallback.
4. A **generic background Web Push** alert is sent to subscribed recipients. A device notification only says someone is trying to reach you: **no worker name, location, request details, phone numbers or authentication tokens** are present on the lock screen. Push is best-effort, not guaranteed.
5. While the app is open, the `assist.list` API is polled for an incoming request: the recipient gets a prominent **pop-up** with location/message and an **Acknowledge — I'm responding** action. Acknowledgement is saved with user and timestamp.
6. Supervisors can see every alert; ordinary facilities team users can see only requests addressed to them. The `Push Subscriptions` tab is never exposed to the frontend.

## Source changes

- `building-watch-trek/index.html`, `app.js`, `sw.js`: request dialog, push setup, service-worker background notifications, recipients' alert popup and inbox.
- `building-watch-trek/core.js` and `building-watch-backend-review/Core.gs`: no phone prompts, phone updates, or phone fields in app API responses.
- `building-watch-backend-review/Assistance.gs`: Google Apps Script private alert data + recipient routing + token-limited worker form + push subscription authorizations.
- `building-watch-backend-review/scripts/apply-assistance.cjs`: guarded patch for the five-spreadsheet QR/email `Code.gs`; replaces the old `tel:` button with an assistance email link and wires the public email form and staff APIs.
- `building-watch-push/`: private PHP Web Push dispatcher using `minishlink/web-push`; hosts VAPID keys only on the controlled backend.

## Deploy (after PR review)

1. **Back up** the currently deployed Apps Script project and its Script Properties. Do not overwrite any customized production code blindly.
2. Start with the **five-spreadsheet, Google Form/QR-capable** `Code.gs` from the last controlled test package, not the earlier single-sheet review copy. Run locally: `node building-watch-backend-review/scripts/apply-assistance.cjs Code.gs Code.with-assistance.gs`. The patch refuses a wrong or already patched base.
3. Add the resulting `Code.with-assistance.gs` contents to the existing Apps Script **Code.gs**, and add `Assistance.gs` and the exact same `Core.gs` version used by this PR. Keep the existing Google Sheets mappings, OAuth client ID and published web app deployment URL. **Do not rerun the older destructive `setup()` on existing records.**
4. In the Apps Script editor, run `setupAssistance()` once to create only the new `Assistance Alerts` and `Push Subscriptions` tabs in the existing Watch Schedule spreadsheet.
5. On the trusted Hostinger HTTPS account, deploy the PHP push dispatcher following `building-watch-push/README.md`. Install Composer dependencies and generate a VAPID key pair. Store the VAPID **private** key and 64-character shared secret outside the public document root.
6. Put the **public** VAPID key in `BW_CONFIG.PUSH_PUBLIC_KEY`; set Apps Script Properties `PUSH_ENDPOINT_URL` (HTTPS, URL ending in `/push.php`) and `PUSH_SHARED_SECRET`. Neither server secret goes in GitHub. Approve and merge the PR, and deploy a new version of the existing Apps Script web app.
7. Each authorized facilities-team user must sign in on their own device and tap **Enable Push Notifications** under **My settings**. Android browsers can subscribe after permission. On compatible iOS versions, the app must be installed on the Home Screen and opened there to grant background push permission.
8. Verify the active watch bill and the current acting manager. Check Admin → **Assistance routing** for recipients and device subscription status. Use a test check-in with fictional details and a consenting real email.

## Acceptance tests

- Verify one and multiple overlapping watchstanders receive a push while the app is closed, when their browser permits background delivery.
- Verify an empty shift routes to the acting building manager, then permanent manager; verify no watch push devices adds a manager fallback.
- Verify email's private assistance link opens a location + message form without a Facilities Team Google sign-in.
- Verify a request appears as a popup on a signed-in recipient's app and can be acknowledged, including recorded by/time.
- Verify the email token expires and is invalidated after checkout. Spam submissions are limited to three per fifteen minutes per source.
- Verify a signed-in non-recipient cannot read/acknowledge another person's alert or register another person's device.
- Verify no telephone numbers, full details or secrets appear in notification payload or email contact buttons.
- Verify behavior when push is not configured, browser permission is denied, phone is offline, no recipient is assigned, or the PHP gateway rejects a delivery. Alerts must remain in the inbox and the screen must not claim guaranteed delivery.

## Automated checks

The pull request contains `tests/assistance.test.cjs` and a PR-only GitHub Actions workflow. These run mocked role/routing/privacy/rate-limit checks and static JS/PHP syntax validation. **Passing unit checks is not evidence that the actual deployed Apps Script, Google Form trigger, PHP server and devices delivered push notifications.** Those must be verified after installation.
