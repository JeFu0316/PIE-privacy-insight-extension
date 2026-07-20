# P.I.E — Chrome Web Store pre-publish review (v2.0.1)

_Reviewed against the current CWS Program Policies, including the July 2026 update
(enforcement begins **August 1, 2026**). This file is a dev note — do not include it
in the uploaded package._

## Verdict

The **code** has no hard policy violations: Manifest V3, no remotely hosted code,
all processing on-device, permissions all used. You can't safely publish yet only
because the **Web Store data disclosures + a privacy policy** must be completed
first (mandatory for anything touching cookies / webRequest / `<all_urls>`), and one
design choice (the Google DNS lookup) is worth removing under the new Aug 1 rules.

---

## Code compliance — PASS

- **Manifest V3**, service-worker background. ✓
- **No remotely hosted code** — no `eval`, `new Function`, `import()`, or remote
  `<script src>`. `importScripts` loads only local files. (MV3 requires all logic to
  ship in the package.) ✓
- **One** external network call only: `https://dns.google/resolve` (see MUST-DO #5). ✓
- **All declared permissions are used** (cookies, tabs, webRequest, storage,
  notifications). ✓
- **No `web_accessible_resources`** exposed to pages. ✓
- **Bundled data is licensed correctly**: Open Cookie Database is Apache-2.0 with
  `COOKIE_DB_LICENSE.txt` attribution shipped; `tracker-domains.js` is self-authored. ✓
- Content script no longer intercepts page fetch/form/storage data. ✓

---

## MUST DO before publishing (blockers)

1. **Post a privacy policy and link it in the dashboard.** Required because P.I.E
   uses `cookies`, `tabs`, `webRequest`, and `<all_urls>`. It must disclose: cookies
   are read locally to detect PII and trackers; requests are observed locally; the
   optional IP lookup sends the visited hostname to Google DNS; settings sync via
   `chrome.storage.sync`; **no data is sent to you or any server you control, and
   nothing is sold.**
2. **Complete the "Privacy practices" tab / data disclosures.** Declare the data
   categories handled, certify **Limited Use** compliance, and — per the July 2026
   update — **prominently disclose all data collection even if related to the single
   purpose.** The only off-device transmission is the optional DNS lookup, so call
   that out specifically.
3. **Write a per-permission justification** (each field in the dashboard):
   - `<all_urls>` host permission — "Reads cookies and observes requests on whatever
     site the user is viewing to analyze cookie PII, third-party trackers, and
     connection security; the set of sites can't be known in advance."
   - `webRequest` — "Read-only observation of request metadata to detect third-party
     cookies and populate the on-device Network list. No blocking or modification."
   - `cookies` — "Read cookie names/values for the active site to detect PII and
     known trackers, and delete cookies on user request."
   - `tabs` — "Read the active tab's URL to scope the scan and show the HTTPS badge."
   - `notifications` — "Optional alert when a site loads third-party cookies."
   - `storage` — "Persist user settings (theme, toggles)."
   - content-script `<all_urls>` match — "Detect a cookie-consent banner on any site."
4. **State the single purpose** clearly: _"Give users insight into a site's cookie
   usage, third-party tracking, and connection security."_ Every data category you
   declare must map to this (the Aug 1 rule lets Google act on a purpose/data mismatch).
5. **Strongly recommended: remove the Google DNS IP lookup** (`getIPAddress` in
   popup.js). It is the **only** thing that sends user data (the visited hostname)
   off-device, it is tangential to the single purpose, and the new Limited Use rule
   ("strictly necessary to the disclosed single purpose") makes it the weakest link.
   Removing it gives a clean "100% on-device — nothing leaves your browser" story
   that is far easier to certify and defend. It's already off by default; removing it
   entirely is safest. (If you keep it: leave it off by default and disclose it in the
   privacy policy + data form.)

---

## Should fix (minor, not blocking)

- Remove `console.log('P.I.E background running')` from `background.js`.
- Delete the stray `err.tmp` from the folder.
- **Package only runtime files.** Include: `manifest.json`, `background.js`,
  `content_script.js`, `popup.html/css/js`, `settings.js`, `cookie-database.js`,
  `tracker-domains.js`, `COOKIE_DB_LICENSE.txt`, `pie16/32/128.png`. **Exclude:**
  `.git/`, `.claude/`, `CLAUDE.md`, `FINDINGS_PIE.md`, `README.md`, `PUBLISH_CHECKLIST.md`,
  `prototype/`, `tests/`, `err.tmp`.
- Icons: the manifest maps size `48` to `pie32.png` (a 32px image). Add a true 48px
  icon, and consider a top-level `"icons"` field (for the management page) in addition
  to `action.default_icon`.

---

## Store-listing checklist

- 128×128 store icon; at least one 1280×800 (or 640×400) screenshot — your ad art can
  seed the promo tile.
- Category (Privacy & Security or Tools); detailed description that matches the single
  purpose (no keyword stuffing).
- Privacy-practices form + privacy-policy URL (blockers #1–#4 above).
- Version `2.0.1` is a valid increment over the live `2.0`. (It's a large redesign — a
  bump to `3.0` would signal that better, but it isn't required.)
- Because of `<all_urls>` + `webRequest`, expect an **in-depth review** (longer
  approval time). That's normal, not a rejection.
- For a true beta, consider publishing **Unlisted** or to a **trusted-testers** group
  first, then flip to Public once it's proven.
