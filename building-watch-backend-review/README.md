# Building Watch

**Building Watch** is a web-based facilities scheduling, building access, and maintenance coordination application. It brings together staff availability, watch assignments, daily responsibilities, maintenance requests, contractor check-in/check-out, and reporting in one mobile-friendly interface.

**The application is deployed and running.** Its current dataset uses fictional Star Trek names and scenarios so that the system can be explored and reviewed without exposing real personnel or visitor information. The fictional content is sample data, not a limitation of the software.

## Open the application

- **Live application:** https://richarddemy.github.io/helloWorld/building-watch-trek/
- **Frontend source:** https://github.com/richarddemy/helloWorld/tree/master/building-watch-trek
- **Backend source:** This folder contains the Google Apps Script implementation (when the source files have been committed).

Building Watch is a browser-based progressive web application (PWA), designed for desktop use and for convenient access on iPhone and Android. Authorized users sign in with their Google accounts rather than maintaining a separate application password.

## What Building Watch does

### Staff availability and scheduling
Facilities team members can enter the times they are available using an interactive calendar. The scheduling interface shows availability alongside existing commitments from selected Google Calendars, helping avoid conflicts. Administrators can review coverage and assign people to building-watch periods.

Watch assignments are initially drafts. An administrator chooses the destination Google Calendar and explicitly publishes pending assignments. Publishing creates Google Calendar events on that selected calendar. Availability entries alone do not publish events.

### Daily watch responsibilities
Assigned members can see their scheduled watches and the tasks associated with them, and record completion of checklist items. Administrators can configure the standard checklist and review assignment coverage.

### Maintenance requests and task tracking
The system records maintenance issues and work requests, including their location, description, priority, status, and work-order information. Staff can review outstanding work, update requests, and relate maintenance activity to the relevant request.

### Worker check-in and check-out
The maintenance log tracks visiting workers, their organization, purpose or assigned work, arrival and departure, completion status, and follow-up issues. The backend includes a Google Forms-based QR check-in workflow that can be initialized by an administrator. Where a worker supplies an email address and consents, the system supports a one-time email sign-out link; watchstanders can review and acknowledge departures. The QR form requires its separate setup step and should be verified in the deployed environment.

### Reporting and accountability
The application supports date-range reports, exportable records, and an audit history for administrative actions. Its information is organized so availability, watch schedules, work requests, and maintenance activity can be examined separately.

### People and access management
There are two application roles:

- **Admin:** manages approved users, scheduling, assignments, calendar configuration, task templates, and administrative functions.
- **Member:** uses the facilities workflows available to an authorized team member, without administrator privileges.

Administrators can add people by Google-linked email address and send invitations. Access is checked by the backend; receiving a link alone does not grant administrator privileges. Email invitations and sign-in should be validated with an additional consenting test account.

## How the system works

```text
Desktop / iPhone / Android
          |
          v
Building Watch PWA (GitHub Pages)
          |
          | Google sign-in ID token + API requests
          v
Google Apps Script Web App
          |
          +-- Google Sheets: application records
          +-- Google Calendar: availability context and published watches
          +-- Google Mail services: invitations and notifications
          +-- Google Forms: optional QR worker check-in
```

**Frontend:** HTML, CSS, and JavaScript are hosted on GitHub Pages. The frontend renders the calendar, staff workflows, forms, administrative controls, and reports. A browser-only demo mode is also available, but the configured application connects to the live backend.

**Authentication and authorization:** Google Identity Services provides the user's sign-in token. The Apps Script backend validates identity and checks application roles before performing protected actions. The backend runs under the deploying Google account's authorized access to its connected services.

**Backend:** Google Apps Script contains the application API, business logic, data validation, email workflows, Google Calendar integration, and spreadsheet persistence. The live Apps Script deployment is separate from the GitHub repository: editing a backend source copy here does **not** automatically update the deployed service.

**Storage:** Five separate Google Sheets hold the application data. These are not publicly editable databases; Google Drive permissions determine who can open the underlying spreadsheets. Users normally interact with the records through Building Watch.

**Calendar publishing:** Administrators select the target calendar. The backend creates real events only when an administrator explicitly publishes pending watch assignments. This prevents availability edits or draft scheduling from silently populating a personal calendar.

## Data sources

The following five Google Sheets contain the current fictional dataset. Their links do **not** grant access; the owner can approve access individually for reviewers.

| Spreadsheet | Purpose |
| --- | --- |
| [Availability](https://docs.google.com/spreadsheets/d/1KJk8VWF2sgV4iMXSXTfp2LCgVg4Ad0aOIEOU8KqIax8/edit) | Staff availability |
| [Watch Schedule](https://docs.google.com/spreadsheets/d/14YYqw5W8HIg-KCr9mxIWq3FIqPpEXqLsIj74-ioizbQ/edit) | People, watch assignments, settings, audit |
| [Maintenance Workers](https://docs.google.com/spreadsheets/d/12PM8tTBRM3vJs-jb__-Q2_HDboYm_Vs2e86tcERZC8s/edit) | Worker arrivals, departures, and work activity |
| [Task Definitions](https://docs.google.com/spreadsheets/d/1uYn00bp1XhtO-iv5rrjSUKxFBwSwtSO8TAt6e9dU9pM/edit) | Maintenance requests and tasks |
| [Task Activity](https://docs.google.com/spreadsheets/d/12BGPkVsYDbgvPJiRAWNVkpKEkCvM8U7An4heEJ1r8QM/edit) | Task activity records |

[Open the Google Drive folder containing the five Sheets](https://drive.google.com/drive/folders/1TDQyWmBbe-9Wk_dZ6DFQFcZcad5hw-C-)

## Backend files

The backend is written in Google Apps Script:

- `Code.gs` — API endpoints, integrations, configuration, authentication support, and Google service operations.
- `Core.gs` — application data model, validation, permissions, and workflow logic.
- `appsscript.json` — Apps Script manifest and requested Google API scopes.

These files can be examined independently of the live deployment. A source review should compare the committed copy with the version actually deployed in Google Apps Script.

## Technical review and verification

The running application and its integrations can be evaluated using the fictional records. Useful checks include account invitation and role enforcement; sign-in and backend token validation; scheduling conflicts and permissions; persistence to the correct Sheet; explicit Calendar publishing; notification delivery; worker check-in and sign-out; and exported reports.

**Deployment status:** The frontend is live and Google sign-in and initial backend setup have been exercised. Individual integrations—including publishing to the selected Google Calendar, invitation delivery to another account, and the optional QR workflow—should be tested independently before relying on them for day-to-day operations.

The Star Trek names and maintenance scenarios are intentional sample records. They can be replaced with authorized organizational information when the deployment environment and access controls have been reviewed.
