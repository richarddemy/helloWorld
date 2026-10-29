# Maintenance QR check-in and Request Assistance — review procedure

**This feature has not been deployed to the live Apps Script or Hostinger backend.** See [ASSISTANCE-SETUP.md](ASSISTANCE-SETUP.md) for the complete integration and rollout plan, and [the draft pull request](https://github.com/richarddemy/helloWorld/pull/1) for oversight.

The QR check-in link remains **admin-only** in Building Watch, under **Admin → Maintenance staff — live check-in test**. The linked Google Form is public to maintenance staff, who do **not** require a Building Watch account.

After submitting the form, consenting maintenance personnel receive an actual check-in email containing:

- **Check Out** — a private, expiring, single-use departure confirmation.
- **Request Assistance** — a private, expiring form asking **Where are you?** and **What help do you need?**.

The assistance request is routed to active watchstanders as a **background Web Push** notification when enabled, or to the acting building manager when no watch shift is active. While the app is open, targeted facilities personnel also receive an in-app alert pop-up, including the location and message, and can acknowledge it.

No telephone or `tel:` links are part of the new email. Current status and subscription details are accessible to authorized app users only. Push device setup and backend deployment are required before live alert delivery can be tested.

**To validate after deployment:** create a current watch shift for an authorized account with a subscribed phone; submit a QR Form with fictional data and a consenting real email; confirm the Maintenance Log entry and worker email; tap **Request Assistance**; verify the recipient's phone push notification and in-app alert; acknowledge it; finally check out and confirm the old assistance token no longer works.

The old test ZIP sent a **Call the Watch** link; it is superseded by the changes in this feature branch and should not be deployed unchanged.
