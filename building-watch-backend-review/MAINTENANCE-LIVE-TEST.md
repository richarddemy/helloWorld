# Maintenance staff — live check-in & email testing

## The two populations

- **Facilities team** signs into Building Watch and handles watch scheduling, shared crew assignments, supervisor approvals, and maintenance oversight.
- **Maintenance staff/contractors** do **not** sign in. Their only entry is a public Google Form opened from a QR code; their checkout happens through an expiring private email link.

The real QR link is available **only in the Admin tab of the signed-in application**. The link itself is public to anyone possessing it, as intended for visitor check-in.

## How to run the live test

1. Sign in as an admin at https://richarddemy.github.io/helloWorld/building-watch-trek/.
2. In **Admin → Maintenance staff — live check-in test**, select **Check live connection**. This calls the role-protected `admin.test` endpoint; the returned `formUrl` is the actual Google Form, not a local browser mock. If none exists, the app offers **Create live QR check-in form** after the updated backend is deployed.
3. Verify the active watch contact email(s) and available mail quota. The backend sends arrival notifications to all currently assigned watchstanders with valid email addresses. If none qualify, it falls back to the acting manager/manager. Fictional `.invalid` addresses cannot receive mail.
4. Save a **Watch telephone** number in Admin so it appears as a clickable `tel:` link in the worker's actual email.
5. Open the live Google Form with the QR or link, enter fictional test visit details, a consenting real email address, and opt in to receiving the checkout email.
6. Open **Maintenance Staff → Refresh arrivals**. The Google Form trigger should have created an actual row in **Maintenance Log** in the Maintenance Workers spreadsheet.
7. Check the consenting worker's inbox for a single-use checkout button and a Call the Watch button, and check the active watchstander's inbox for an arrival alert.
8. Use the email checkout link to confirm departure and verify that a new departure alert reaches whoever is on watch. Admins can inspect the Test email delivery column to see which sends were **accepted by MailApp**, not whether they arrived in the recipient's inbox.

The app no longer shows a simulated email preview or links the maintenance QR to `contractor.html`.

## Apps Script deployment boundary

**GitHub Pages updates do not update the Apps Script web app.** The live mail and form enhancements require updating the existing Apps Script project with the latest tested `Code.gs` and `Core.gs`, authorizing its Mail/Forms/Sheets scopes, and publishing a **new version of the existing deployment**. Do not replace an independently modified live script without first backing it up and merging its changes.

The staged `Code.gs` originally in this review directory is from the earlier single-sheet backend; it is not the latest five-sheet live-calendar + QR variant. The full five-sheet integration bundle was prepared as `building-watch-maintenance-email-test.zip` in the project chat for controlled deployment. This repository includes the latest `Core.gs` with permissions for crew assignments and a validated `watchPhone` setting.

No live email has been sent from these repository changes. The live test requires a real form submission after deployment, and permission from the recipient.