# Building Watch — Star Trek test PWA

Public **frontend only**. The private Google Sheets and the Apps Script backend stay in the owner's Google account. The app is a fictional-data test, not an operational Navy system.

## Open / install

- Preview (browser demo): https://raw.githack.com/richarddemy/helloWorld/master/building-watch-trek/index.html
- Preferred installable PWA after enabling GitHub Pages: https://richarddemy.github.io/helloWorld/building-watch-trek/

To enable GitHub Pages: GitHub repository Settings → Pages → Deploy from branch → master → /(root) → Save. Never put secrets or real tester records in this public repository.

## Backend connection

In the private Google Drive folder *Building Watch — Star Trek Demo (Fictional Data)*, use the most recent **Building-Watch-Star-Trek-Live-Calendar-QR-v2.zip** setup package. It contains the Apps Script source and detailed setup directions. In the Script Editor, run `setup()`, authorize, and deploy as a web app, then add the `/exec` URL and Web OAuth client ID to `config.js` in this public folder.

Until `config.js` is configured, changes are local to the browser and **no real email, Google Sheet edits or calendar events are sent**.

## Actual publishing after connection

In Admin: **Load my calendars → Select a calendar → Save calendar settings**. Draft watch assignments. Then click **Publish pending assignments** and confirm the event count. This creates actual events in the selected Google Calendar only. Availability submissions do not automatically change calendars. Test invitations can be enabled for consenting recipients; fictional `.invalid` and `example.com` addresses are never emailed.

Run `setupWorkerForm()` in the private Apps Script editor to create a QR-linked Google Form that logs maintenance check-ins and can send one-time email sign-out links.

The Apps Script deployment / Google OAuth configuration requires the account owner's interactive authorization; the GitHub frontend alone is not a complete live system.
