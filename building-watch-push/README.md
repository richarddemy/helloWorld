# Building Watch — private Web Push gateway

This directory is a deployment package for the user's **own** HTTPS PHP host. It is *not* published by GitHub Pages and needs server-side configuration before it can send true background notifications.

The public app never stores phone numbers or push credentials. The browser subscribes using the public VAPID key, the authenticated Apps Script stores subscriptions in a private Google Sheet, and the private Apps Script calls this gateway using a server-to-server shared secret. Only an authorized Google user can register a device.

1. On the HTTPS host (PHP 8.2+), install Composer dependencies using `composer install --no-dev --optimize-autoloader`; keep `vendor/` outside the public URL path except for the needed autoloader.
2. Run a one-time PHP command using `Minishlink\\WebPush\\VAPID::createVapidKeys()` (see library documentation) to generate the VAPID keys. Save the public key in the app's `BW_CONFIG.PUSH_PUBLIC_KEY`, and keep the **private key** solely in the PHP secrets file.
3. Copy `config.example.php` to **outside** the publicly served directory as `bw-push-secrets.php`; configure `shared_secret` (random 64 characters), `vapid_subject`, public and private VAPID keys. Configure the private file path as needed for hosting.
4. Deploy `public/push.php` at an HTTPS URL ending in `/push.php` (e.g. `https://demymusic.com/building-watch-push/push.php`). Configure the PHP script's dependency autoload path to the private Composer location.
5. In the private Apps Script **Script Properties**, set `PUSH_ENDPOINT_URL` to that URL and `PUSH_SHARED_SECRET` to the exact random shared secret. **Never commit either value.**
6. Run `setupAssistance()` in the Apps Script editor to create `Assistance Alerts` and `Push Subscriptions` tabs in the existing watch spreadsheet, then deploy a new version of the existing Apps Script web app.
7. Install Building Watch on the facilities team's phone, sign in with an authorized Google account, and choose **Enable Push Notifications**. Check **Admin → Assistance routing** for the active watch recipients and their subscription state.

**Important:** iOS background Web Push requires the web application to be added to the Home Screen on compatible iOS versions and the user to permit notifications. Android browsers generally require permission as well. Push is best-effort: a disabled, offline, expired or unregistered device may not receive it. In-app polling provides a second path while the app is open, but is not a substitute for Web Push.

**Security:** The push payload is intentionally generic; full location and request details are fetched only after Google sign-in. Do not configure the gateway as an open unauthenticated send service.
