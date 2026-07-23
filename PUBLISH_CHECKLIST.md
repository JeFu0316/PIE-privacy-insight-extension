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
- **Three** external network calls:
  - `https://dns.google/resolve` (site IP and optional PTR for your exit IP) — optional, off by default.
  - `https://www.cloudflare.com/cdn-cgi/trace` (your public exit IP) — optional, off by default.
  - `https://formspree.io/f/mrenarao` (user-submitted bug/feedback reports) — **user-initiated only**; sends topic, URL, details, extension version, and locale. No cookies, browsing history, or cookie values are transmitted. See privacy policy.
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
   optional IP lookup sends the visited hostname to Google DNS; user-submitted
   feedback reports POST topic/url/details/version/locale to Formspree
   (formspree.io) — user-initiated, no cookies or browsing history included;
   settings sync via `chrome.storage.sync`; **no browsing data is sold.**
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

- ~~Remove `console.log('P.I.E background running')` from `background.js`.~~ **Done.**
- ~~Delete the stray `err.tmp` from the folder.~~ **Done.**
- **Package only runtime files.** Include: `manifest.json`, `background.js`,
  `content_script.js`, `popup.html/css/js`, `settings.js`, `i18n.js`, `exit-ip.js`,
  `digest.js`, `reports.js`, `cookie-database.js`, `tracker-domains.js`,
  `COOKIE_DB_LICENSE.txt`, `toolingo-mark.png`, `toolingo16/32/128.png`. **Exclude:**
  `.git/`, `.claude/`, `CLAUDE.md`, `FINDINGS_PIE.md`, `README.md`,
  `PUBLISH_CHECKLIST.md`, `prototype/`, `tests/`, `dist/`, `err.tmp`, legacy
  `pie16/32/128.png` (optional keep). Keep the privacy-policy clone at
  `C:\PIE-privacy-site` (outside the extension root — Chrome rejects `_`-prefixed
  folder names on Load unpacked).
- ~~Icons: the manifest maps size `48` to `pie32.png` (a 32px image).~~ **Partly done:**
  the 48px slot now downscales from `pie128.png` (sharper than upscaling the 32px), a
  `32` mapping was added, and a top-level `"icons"` field now mirrors
  `action.default_icon`. _Optional polish:_ ship a hand-tuned native `pie48.png`.

## Decisions (this release)

- **IP/DNS lookup:** KEEP, off by default, disclosed in the privacy policy (blocker #1).
- **Cookie banners (#2):** **Done** — optional, clearly-labelled best-effort CSS
  auto-hide (`bannerAutoHide`, off by default) in `content_script.js`; not full
  blocking. Add a content-script justification to the dashboard: "Optionally hides
  detected cookie-consent banners with CSS at the user's request."
- **Version:** **2.0.2** (pending CWS review — leave that package unchanged).

---

## Next package: 2.1.0 Toolingo — Phases 3–6 (feature/toolingo-2.1.0-phase2)

### New permissions (Phases 3–6)
- **`declarativeNetRequest`** — optional tracker blocking. Justification: "Blocks
  third-party requests to a bundled list of known tracker domains when the user
  opts in via Settings > Block known trackers. No data leaves the device."

### New runtime JS files (must be included in package)
- `clean-urls.js` — on-device tracking-param removal (Phase 3)
- `block-stats.js` — per-tab and lifetime block counters (Phase 4)
- `ai-explain.js` — on-device AI privacy explain wrapper (Phase 6)

### AI disclosure requirement
The Phase 6 AI explain feature uses **Chrome's built-in on-device LanguageModel
API only**. No cloud LLM or third-party AI service is contacted. Cookie values,
URLs, or browsing data are **never sent to AI prompts** — only structured
findings (counts + labels) are used. This must be disclosed in the store listing
and privacy policy.

### DNR tracker blocking disclosure
Phase 4 adds opt-in blocking via `declarativeNetRequest` using a bundled, static
list of ~130 known tracker domains. Rules are applied third-party only; first-party
requests are never blocked. Disabling the setting clears all rules atomically.

### Fingerprint detection disclosure
Phase 5 content script injects a MAIN-world watcher that counts canvas and audio
fingerprinting API calls. Only aggregate counts (integers) are passed back via
postMessage — no pixel data, audio buffers, or page content. Shield mode adds
tiny noise to canvas reads (opt-in, off by default).

### Updated package file list (v2.1.0)
`manifest.json`, `background.js`, `content_script.js`, `popup.html/css/js`,
`settings.js`, `i18n.js`, `exit-ip.js`, `digest.js`, `reports.js`,
`cookie-database.js`, `tracker-domains.js`, `block-stats.js`, `clean-urls.js`,
`ai-explain.js`, `COOKIE_DB_LICENSE.txt`,
`toolingo-mark.png`, `toolingo16.png`, `toolingo32.png`, `toolingo128.png`.

### Formspree
Still listed in MUST DO (user-initiated feedback only, no cookies or browsing data).

### Per-permission justification updates
- `declarativeNetRequest` — "Blocks third-party requests to known tracker domains
  when user enables 'Block known trackers' in Settings. On-device static ruleset."
- Refresh store screenshots / promo tiles with the Toolingo wordmark so listing art
  matches the popup (Canva after code rename).
- Single purpose copy unchanged — no toolbox claims.

---

## Store-listing checklist

- 128×128 store icon; at least one 1280×800 (or 640×400) screenshot — your ad art can
  seed the promo tile.
- Category (Privacy & Security or Tools); detailed description that matches the single
  purpose (no keyword stuffing).
- Privacy-practices form + privacy-policy URL (blockers #1–#4 above).
- Version `2.0.2` pending; next increment after live is **`2.1.0` (Toolingo)**.
- Because of `<all_urls>` + `webRequest`, expect an **in-depth review** (longer
  approval time). That's normal, not a rejection.
- For a true beta, consider publishing **Unlisted** or to a **trusted-testers** group
  first, then flip to Public once it's proven.
