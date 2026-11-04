# Starfleet Scheduling — Building Watch

This is a scheduling-only frontend rebuilt from the complete **previous Star Trek Building Watch** code, rather than a separate scheduling engine.

- Live: https://richarddemy.github.io/helloWorld/building-watch-scheduling/
- Fictional demo: https://richarddemy.github.io/helloWorld/building-watch-scheduling/?demo
- Existing Google Apps Script URL and OAuth client ID: unchanged from the prior Star Trek version (`config.js`).
- Existing `core.js`: byte-for-byte copy of the prior working edition.
- Existing backend and Google Sheets: no deployment or settings changes.
- Availability, duty watch assignments, admin publishing, personal calendar overlays and existing authentication all use the original functions.
- Maintenance log, service requests, facilities assignments and worker alerts are hidden or disabled in this frontend, not deleted from the backend.

The live application requires the configured Google account and an accessible working Apps Script backend. The demo never touches the backend, stores fictional changes in the local browser, and has a separate cache and storage key from other versions.

**Security:** This is still a public GitHub Pages frontend. Do not use real operational Navy personnel or watch information until command cybersecurity authorization and the Google service authorization boundary have been established.

## Two-front-end testbed (4 November 2026)

These are separate GitHub Pages interfaces to the **same configured Google Apps Script endpoint and Google Sheets**. No backend change is required for existing scheduling operations.

- Full Building Watch: https://richarddemy.github.io/helloWorld/building-watch-trek/
- Scheduling-only console: https://richarddemy.github.io/helloWorld/building-watch-scheduling/
- Full fictional demo: https://richarddemy.github.io/helloWorld/building-watch-trek/?demo
- Scheduling fictional demo: https://richarddemy.github.io/helloWorld/building-watch-scheduling/?demo

In either demo, choose Admin or Sailor and try painting availability, saving it, selecting a watch block and assigning someone. Use the header's link to switch interfaces. The **two fictional demos share one browser-local sample datastore** and can show each other's changes on page reload; they never write Google Sheets or Calendar. They share sample state only in the **same browser and origin**, not across devices.

Outside `?demo`, both interfaces use the same `config.js` Apps Script URL and Google sign-in client ID and require a Google account authorized by the existing backend. Only the original full interface has worker check-in, maintenance requests, crew assignments and reports. Only administrators can perform restricted scheduling actions, enforced by the backend.

To present to reviewers without granting Google account access, **use the two `?demo` links**. The live Google-connected path must be tested interactively using an authorized sign-in before being represented as fully end-to-end verified. This is a fictional-data testbed, not approved Navy operational software.
