# Connecting the schedule to Google

About 10 minutes. Do this signed in to the Google account that should own the data and the calendar. That account runs the app, and whoever runs `setup()` becomes the first admin.

## 1. Make the Sheet and paste the code

1. Open [sheets.new](https://sheets.new) and name the file **Building Watch Schedule**.
2. Choose **Extensions, Apps Script**.
3. Replace everything in `Code.gs` with `backend/Code.gs` from this folder.
4. Click **+**, choose **Script**, name it `Core`, and paste in `backend/Core.gs`.
5. Save.

## 2. Run setup

1. In the function list at the top, choose `setup`, then **Run**.
2. Approve the permissions. Google may warn the app is unverified: choose **Advanced**, then **Go to project**.
3. The Sheet now has People, Hours, Watches, Audit and Settings tabs, and your account is the first admin.

## 3. Deploy

1. **Deploy, New deployment**. Click the gear and choose **Web app**.
2. **Execute as:** Me. **Who has access:** Anyone. Everyone is still checked against the People list; this setting only lets the page reach the backend.
3. **Deploy**, then copy the address ending in `/exec`.

## 4. Connect the page

Put the `/exec` address in `config.js` as `SCRIPT_URL`, or send it to Claude to do. The page leaves demo mode and shows **Sign in with Google**.

## 5. First use

1. Sign in and enter your rank and name.
2. **Calendar** tab: press **Create a Building Watch calendar**, then **Save calendar settings**.
3. **People** tab: add each person by the Google address they will sign in with, and send them the invite link. Make the building manager an admin. Clear **Stands watch** for anyone who only manages.

## Updating later

Paste the changed file over the old one, then **Deploy, Manage deployments**, edit the existing deployment, and choose **New version**. This keeps the same address.

## Moving it to another account

**File, Make a copy** on the Sheet copies the code too. In the copy, repeat steps 2 to 4. The new account needs its own calendar, and a new `CLIENT_ID` if the Google Cloud project moves with it.

## If something goes wrong

| What you see | What to do |
| --- | --- |
| "Sign-in is not set up for this app" | `CLIENT_ID` in `Code.gs` must match `config.js`. Run `setup()` again. |
| Google sign-in button gives an origin error | In Google Cloud, add `https://richarddemy.github.io` to the client's authorized JavaScript origins. |
| "Can't reach the server" | Deployment access must be **Anyone**. Some organizations block this setting. |
| Changes don't appear | Deploy a **New version**. Saving the script alone does not update the live app. |
