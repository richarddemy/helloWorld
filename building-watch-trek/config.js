// HOW TO READ THIS FILE (for non-programmers)
// Lines starting with two slashes are notes for people; the browser ignores them.
// This tiny file tells the app where its backend is and how to sign people in.
// If either value is missing, the app runs as a demo with sample data.
/* Connect only after deploying the private Google Apps Script endpoint.
 * These are public client identifiers, never put passwords or secrets here.
 * Until configured the app is an interactive fictional-data browser demo.
 */
window.BW_CONFIG = {
 // SCRIPT_URL: the web address of the Apps Script backend (Code.gs), from
 // Deploy, Manage deployments. Keep it the same by publishing new versions
 // of the existing deployment rather than creating new deployments.
 SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbwWdaUxqFfcFokpY6R0q-Yauei56LcPfs--sYpzaf9meyzc-xfAFd7RmrYr8fn-UT_bLQ/exec',
  // GOOGLE_CLIENT_ID: the sign-in client ID from Google Cloud. Public by design.
  GOOGLE_CLIENT_ID: '173552030795-7c7rvjm88ul8is68thpbfj6uhrd89s43.apps.googleusercontent.com'
};
