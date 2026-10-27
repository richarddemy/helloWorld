# Building Watch — Star Trek Test

Public **frontend only**, with fictional characters and test records. Backend Sheets stay in the owner's private Google Drive.

Preview: https://raw.githack.com/richarddemy/helloWorld/master/building-watch-trek/index.html

Preferred installable PWA address after enabling Pages: https://richarddemy.github.io/helloWorld/building-watch-trek/

GitHub Pages: repository Settings → Pages → Deploy from branch → master → /(root). Nothing confidential belongs in this public repo.

To enable live sign-in and private Sheets, deploy the separate Apps Script project as owner, create Google OAuth web client with Authorized JavaScript origins https://richarddemy.github.io and https://raw.githack.com (for preview only), and update config.js with the /exec URL and client ID.

*Demo mode stores changes only in the browser; it does not access the five Sheets or send real email. A connected Google backend is a separate deployment step.*
