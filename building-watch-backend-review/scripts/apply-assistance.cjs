#!/usr/bin/env node
/**
 * Merge Assistance.gs hooks into the 5-sheet live Building Watch Code.gs.
 * Works on a LOCAL COPY. Refuses ambiguous or previously applied sources.
 *
 * Usage:
 *   node scripts/apply-assistance.cjs ./Code.gs ./Code.with-assistance.gs
 */
const fs = require('node:fs');
const path = require('node:path');
const [input,output] = process.argv.slice(2);
if (!input || !output || path.resolve(input)===path.resolve(output)) {
  console.error('Usage: node apply-assistance.cjs Code.gs Code.with-assistance.gs');
  process.exit(2);
}
let source=fs.readFileSync(input,'utf8');
if(!source.includes('function notifyWorkerArrival_(st, l)') || !source.includes('function onWorkerFormSubmit_(event)'))
  throw new Error('This is not the five-sheet QR/email backend. Do not patch the older single-sheet Code.gs.');
if(source.includes('assistHandle_(') || source.includes('assistForm_('))
  throw new Error('Assistance routing already present. Refusing a second application.');
function once(a,b) {
  const i=source.indexOf(a);
  if(i<0 || source.indexOf(a,i+1)>=0) throw new Error('Missing or ambiguous integration anchor: '+a.slice(0,80));
  source=source.replace(a,b);
}
once('function doGet(e) {\n','function doGet(e) {\n  if (e && e.parameter && e.parameter.assist) return assistForm_(String(e.parameter.assist));\n');
once('function doPost(e) {\n  var out;\n  try {\n',
  'function doPost(e) {\n  var out;\n  try {\n    if (e && e.parameter && e.parameter.assistToken) return assistWorkerSubmit_(e.parameter);\n');
once('      else if (req.action === "admin.calendars")',
  '      else if (req.action.indexOf("assist.") === 0) data = assistHandle_(st, email, req.action, req.payload || {});\n      else if (req.action === "admin.calendars")');

const start=source.indexOf("  var phone = String(st.settings.watchPhone || '').trim();");
const end=source.indexOf('  l.tokenHash = tokenDigest_(token);',start);
if(start<0||end<start)throw new Error('Old phone link block not found; source has diverged.');
source=source.slice(0,start)+"  var assistanceLink = url + '?assist=' + encodeURIComponent(token);\n"+source.slice(end);
const textLink="'\\n\\nWhen leaving, open this private, single-use checkout link:\\n' + link + '\\n' + phoneLine +";
if(!source.includes(textLink))throw new Error('Email text link insertion point has changed.');
source=source.replace(textLink,
  "'\\n\\nWhen leaving, open this private, single-use checkout link:\\n' + link + "+
  "'\\n\\nNeed assistance? Send the current watch a message using this private link:\\n' + assistanceLink +");

const htmlButton =
  "'<p><a style=\"display:inline-block;padding:14px 20px;border-radius:6px;background:#234f74;color:#fff;text-decoration:none\" href=\"' + htmlSafe_(link) + '\">Check out when you leave</a></p>' +";
if(!source.includes(htmlButton))throw new Error('Email checkout HTML button has changed.');
source=source.replace(htmlButton,htmlButton+"\n"+
  "      '<p><a style=\"display:inline-block;padding:14px 20px;border-radius:6px;background:#e2a04f;color:#142133;text-decoration:none\" href=\"' + htmlSafe_(assistanceLink) + '\">Request Assistance</a></p>' +");

const line=source.split('\n').filter(x=>x.includes("(phone ? '<p><a") && x.includes('Call the facilities watch'));
if(line.length!==1)throw new Error('Telephone HTML link not found exactly once.');
source=source.replace(line[0]+'\n','');
if(source.includes('phoneLine') || source.includes("Call the facilities watch:"))
  throw new Error('A phone link was left in the worker notification.');
// Keep email link token handling in Google Apps Script; the public website receives no bearer token.
fs.writeFileSync(output,source,'utf8');
console.log('Assistance routing successfully patched into '+output+'.');
console.log('Add Assistance.gs and current Core.gs to the script project, run setupAssistance(), and deploy a new version.');
