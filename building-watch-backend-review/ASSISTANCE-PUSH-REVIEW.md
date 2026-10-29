# Request Assistance — design and implementation review

## Separation of roles

Facilities Team users authenticate to Building Watch. Maintenance staff and contractors **do not authenticate** and do not receive any facilities user's personal telephone number.

The **Request Assistance** action replaces **Call the Watch** in both the facilities application and the maintenance worker checkout-email journey. It collects a location and short description of the help needed.

## Proposed end-to-end workflow

1. A worker scans the maintenance check-in QR and submits the check-in Google Form. The server creates a log record and sends a confirmation email containing a **Request Assistance** URL bound to that worker's visit (a scoped, unpredictable, expiring token).
2. The worker taps the email link, enters their location and message, and submits. The backend verifies the token and rate limits requests. **The public worker endpoint must never accept a recipient ID or personal email supplied by the worker.**
3. The backend identifies all people on watch at the current time using the authoritative schedule; if none are scheduled, it routes to the acting manager (or building manager). An alert is stored durably before delivery.
4. Each eligible facilities user receives a push notification on an opted-in personal phone. Tapping it opens the app's Assistance Alerts screen. The alert displays the location and message and supports **Acknowledge**. Acknowledgment is stored and visible to other assigned responders.
5. The sender sees an honest status: request recorded / notification queued / acknowledged. Do not claim that someone received or read it based on an API success alone.

## What is implemented in this branch

- Removed the watch phone number control from the Admin UI and removed the watchPhone setting from the shared core.
- Added role-scoped `assistanceAlerts` storage and authenticated `assistance.create` and `assistance.ack` actions to shared Core, plus the corresponding schema in the **staged** Apps Script code.
- Added an Assistance Alerts tab, request dialog, acknowledgment controls, and manual refresh to the facilities app.
- These are reviewable changes on a **feature branch**, not deployed to the live GitHub Pages site or Google Apps Script.

## What is NOT implemented or verified

**Real background push notifications are not implemented yet.** A service worker alone cannot send push. A deployment needs an HTTPS Push API subscription for each opted-in device, a backend storing subscriptions and VAPID private key in server-side secret storage, a Web Push sender, expiry/revocation, error handling, and an authorized public worker-token endpoint. No phone number is needed. Browser and iOS home-screen installation/notification permissions must be tested on physical devices.

**The email's Request Assistance link is not yet wired.** The live Google Apps Script project has not been updated, and the staged `Code.gs` is an older integration baseline rather than a drop-in replacement for the five-sheet production deployment. The old public `contractor.html` simulation remains retired. Do not merge/deploy as a complete push solution until the backend endpoint, worker email template, and push sender are integrated and tested.

**Security requirements:** authenticated recipients only; server-side recipient resolution; signed or random visit-scoped expiring token; rate limits and abuse monitoring; no user-supplied destination addresses; no personal numbers; no notification content beyond minimum necessary; HTTPS; revoke subscriptions on sign-out; no exposure of VAPID private keys in the GitHub Pages repository.

## Acceptance tests

- Active watchstander gets an alert; when two shifts overlap, both receive it.
- No active watchstander routes to the acting manager, then building manager.
- Worker with an expired or used token cannot send unauthorized requests.
- Non-recipient cannot retrieve or acknowledge another person's alert.
- Worker receives a clear confirmation only after the alert is recorded.
- Opted-in Android and iOS devices receive a notification with the app in the background, and acknowledgment syncs across devices.
- No personal telephone numbers appear in app UI, QR URL, email, notification, or logs.

**Release gate:** supervisor review, backend integration, push tests, and explicit approval before merge to `master`.