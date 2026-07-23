# P.I.E — Deep Analysis & Update Roadmap

Analysis of the published Privacy Insight Extension (Manifest V3, v2.0) ahead of a
major update. Prepared before any code changes — for your approval.

## Overall assessment

P.I.E is a genuinely solid privacy extension. The PII detection engine
(`detectPII`) is more sophisticated than most published equivalents: Shannon
entropy analysis, Luhn credit-card validation, JWT payload inspection, base64
decoding, and a benign-cookie dampening list. The architecture is clean and the
code is readable. The updates below build on a strong base rather than fixing a
weak one.

---

## Priority 1 — Correctness & platform risk (do first)

### 1a. Manifest V3 / webRequest exposure  [VERIFIED 2026-07-10 — keep current approach]
`manifest.json` requests `webRequest`; `background.js` uses
`chrome.webRequest.onHeadersReceived` (read-only, responseHeaders) for third-party
cookie detection. Under MV3, the blocking powers of webRequest were removed in
favour of declarativeNetRequest. The current listener is observe-only, which is
still permitted, but it is a fragile surface Google keeps tightening.

**Verification result:** Chrome's official MV3 docs confirm that aside from the
removed `"webRequestBlocking"` permission, the `webRequest` API remains available
for **non-blocking observation**. P.I.E's listener uses `["responseHeaders"]` only
(no `"blocking"` in `extraInfoSpec`) — compliant and durable for observation.
Blocking or header modification would require `declarativeNetRequest`; banner
blocking (#2) cannot use blocking webRequest in a public extension.

**Recommendation:** Keep the current read-only listener for third-party cookie
detection. Revisit only if Chrome deprecates non-blocking webRequest (no signal
as of 2026). Do not add `"webRequestBlocking"`.

### 1b. Detail-view cookie cutoff bug  [DONE — Phase 1]
`popup.css`: `#list { max-height: 300px; overflow-y: auto; }` inside a fixed
`body { width: 550px; }`. Cookies are capped and scroll inside a small box, so the
list looks truncated. Chrome popups allow up to ~600x800px.
FIX: raise/remove the max-height, let the popup use available height, keep a
sensible scroll. Low risk. **Shipped** in the tabbed UI redesign (`.body`
max-height 460px with scroll; old `#list` 300px cap removed).

### 1c. Simple-view 10-cookie cap  [DONE — removed in redesign]
`renderSimpleView` slices to `.slice(0, 10)` with a "+N more" note. Intentional,
but worth revisiting once the resize is done — the cap may no longer be needed.

---

## Priority 2 — Scoring redesign (highest user-facing value)

### The problem (confirmed — matches your complaint)
The risk model conflates two different things into one "risk" score. High-entropy
strings and long hex/UUIDs score 0.6–0.75 and render as MODERATE. But tracking IDs
like `_ga` are SUPPOSED to be high-entropy random identifiers — they are not
personal data. Result: benign analytics cookies flagged moderate.

### The fix — split into two independent axes
- **Sensitivity**: does it contain real PII? (email, name, credit card, JWT with
  identifiers) — keep and refine the existing detectPII logic for this.
- **Tracking**: is it a known cross-site tracker / third-party identifier? —
  determine by LOOKUP against a bundled cookie database, not by guessing from
  entropy.

A cookie can be high-tracking / low-sensitivity (`_ga`) or low-tracking /
high-sensitivity (first-party session token holding your email). Showing these as
two badges instead of one score fixes the false-moderate problem directly.

### Enabler: bundle a local cookie database (answers the on-device question)
Ship the Open Cookie Database (downloadable CSV, categorises major cookies) or
Cookiedatabase.org data locally, refreshed periodically. This gives accurate
tracker names/categories WITHOUT sending the user's cookies or browsing to any
external API — preserving the privacy-first promise. See architecture note below.

---

## Priority 3 — Settings foundation (unlocks #1, #3, #6 together)

Ideas #1 (light/dark), #3 (settings panel), and #6 (theme colours/effects) all
depend on one missing piece: a persistent settings layer.

### Build once: chrome.storage.sync layer  [DONE — Phase 1]
User chose cross-device sync. Create a settings module that reads/writes
`chrome.storage.sync`, with sensible defaults and a migration path. Everything
else rides on this.

**Shipped:** `settings.js` (`PIE_SETTINGS.load` / `.save`, schema v1). Keys:
`theme`, `defaultTab`, `thirdPartyNotifications`, `ipLookupEnabled`. Wired into
popup (theme + tab + IP gate) and background (notification gate). Settings panel
UI still Phase 3.

### Themes (research-informed)  [DONE — Phase 3]
Developer theme preferences cluster around a small, well-loved set. Recommended
starter pack: Dark (current), Light, plus 2–3 crowd favourites in the style of
Catppuccin (soft pastel, "pick of 2026"), Dracula (strong colour separation), and
Nord/Tokyo Night (calm blue-toned). Include at least one accessibility/colour-blind
friendly option (GitHub-style themes are noted for colour-blind support).

**Shipped:** System, Light, Dark, Catppuccin (Mocha), Dracula, Nord, and a
Colour-safe theme (Okabe-Ito palette — severity uses blue→orange→vermillion, no
red/green reliance). Each is a `:root[data-theme="…"]` CSS-variable set in
`popup.css`; selectable via a swatch-grid picker with colour previews in the
settings panel; validated in `settings.js` and covered by `settings.test.js`.
Implement via CSS custom properties (variables) so a theme is just a variable set —
this also makes user-defined custom colours trivial later.

### Settings panel contents (starting ideas — expand freely)
- Theme selector + light/dark toggle (+ "match system")
- Which analyses run (PII detection, tracker lookup, third-party alerts)
- Notification preferences (the background.js notifications are currently always-on)
- Simple vs detailed as default view
- Toggle the external IP/DNS lookup (privacy-sensitive — see below)
- "Delete all flagged cookies" behaviour / confirmations

---

## Priority 4 — Enhancements (smaller lifts)

### #5 Delete sensitive cookies — ALREADY HALF-BUILT
`deleteCookie()` and a per-cookie Delete button already exist and work. This is an
ENHANCEMENT, not new work:
- Add a "Delete all flagged" bulk action.
- Add the breakage warning you asked about ("this may log you out / break site
  features"), shown before deletion.
Verdict: possible, needed, low lift.

### #2 Block cookie banners — SHIPPED as best-effort auto-hide (option a)
Detecting banners (MutationObserver) was already done. Full BLOCKING/dismissing is
out of scope (community rule sets + MV3 network constraints, see 1a).

**Shipped (option a):** an opt-in, off-by-default `bannerAutoHide` setting. When on,
`content_script.js` injects a CSS rule hiding well-known CMP containers and hides
the detected consent element inline, then restores page scroll if the banner locked
it. Clearly labelled in the settings panel as "best-effort" — it is cosmetic only,
does NOT click "reject" or change the site's consent state, and may hide the wrong
element or miss a banner. Live-toggles via `chrome.storage.onChanged`; takes full
effect on the next page load. No new permissions (uses existing `storage`).
Deferred: option (b) community rulesets and any true network-level blocking.

---

## Architecture note — the privacy question you delegated to the team

**Recommendation: stay 100% on-device for anything about the user's data; bundle a
local database instead of calling an external API.**

Rationale: the extension's whole value is privacy. Sending a user's cookie list or
visited domains to a third-party classification API would contradict that and is
the kind of thing a reviewer or informed user flags. A bundled, periodically
self-updated Open Cookie Database gives accurate tracker classification with zero
per-user network calls.

Also: the existing Google DNS IP lookup in popup.js IS an external call that leaks
the visited hostname. Make it optional, off-by-default or clearly disclosed, and
surfaced in settings.

---

## Suggested phase order (for approval)

1. **Foundation & fixes**: ~~MV3 verification (1a)~~ ✓, ~~detail-view resize (1b)~~ ✓,
   ~~chrome.storage.sync settings layer (P3 core)~~ ✓.
2. **Scoring redesign**: two-axis model + bundled cookie DB (P2). **Done.**
3. **Theming**: CSS-variable themes + selector, riding on the settings layer (P3).
4. **Enhancements**: bulk delete + breakage warning (#5); optional best-effort
   banner hide (#2, if approved). **Done — bulk delete + best-effort banner hide both shipped.**
5. **Retention / active value (Phase A)**: convert P.I.E from passive insight to an
   active tool, prompted by tester feedback that it had "limited usage."
   - **Toolbar badge tracker count** — the icon shows how many known trackers the
     current tab contacted (setting `trackerBadge`, on by default). Replaces the
     old HTTPS ✔/! badge; HTTPS still shows in the popup site bar + Security tab.
   - **Cookie Auto-Clean** — opt-in (`autoClean`, off by default). Removes cookies
     from known tracker/ad domains (never first-party/logins; skips Consent CMPs so
     banners don't reappear) on tab close, debounced. Respects `autoCleanAllowlist`
     (base domains). Also a manual "Clean tracker cookies now" button in settings.
     All on-device via `chrome.cookies` — no new permissions.
   - **Deferred:** real header-level blocking via `declarativeNetRequest` (needs a
     new manifest permission) — revisit after Auto-Clean proves itself. Also on the
     backlog: fingerprinting detection, weekly privacy report, permission auditor.

Each phase ends with a review pass and a check-in before the next begins.

## Open questions for you — RESOLVED
- Banner blocking: ~~descope to optional "best-effort hide", or defer entirely?~~
  → **Shipped best-effort hide (opt-in, off by default).**
- IP/DNS lookup: ~~keep (disclosed), make optional, or remove?~~
  → **Kept, off by default; disclose in privacy policy.**
- Version bump target: ~~is this a 3.0?~~ → **2.0.2** (pending CWS). Next store ship after 2.0.2 is live: **2.1.0 Toolingo**.

---

## Toolingo brand (Phase 1) — DONE

**Decision:** Public brand is **Toolingo**; subtitle **Privacy Insight**. Same single
Chrome Web Store purpose (cookies / third-party tracking / connection security) —
not a multi-purpose toolbox. Keep “P.I.E” only as legacy/engine shorthand in docs
if useful; store-facing name is Toolingo.

**Shipped in code for 2.1.0 (do not amend the pending 2.0.2 package):**
- `manifest.json` name `Toolingo - Privacy Insight`, version `2.1.0`
- Popup hero + footer + feedback mailto templates via i18n
- Privacy policy at https://jefu0316.github.io/Index.html/ retitled for Toolingo
- Toolingo mark shipped: popup logo uses CSS mask (`toolingo-mark.png`) tinted with
  `--logo` → `--text` so it stays high-contrast across themes; toolbar/store icons
  are branded purple tiles (`toolingo16/32/128.png`)

**Single-purpose rule (unchanged):** Give users insight into a site’s cookie usage,
third-party tracking, and connection security. No “all-in-one tools suite” store copy.

### Phase 2 candidates (Toolingo Privacy — after 2.1.0 brand is live)
Still purpose-aligned; build one-by-one with an explicit go each time:
- **Allowlist UI** for Auto-Clean (`autoCleanAllowlist`) — **DONE (Phase 2a)**
- **Weekly privacy digest** (on-device summary; no external upload) — **DONE (Phase 2b)**
- **Optional DNR tracker block** (`declarativeNetRequest` — new permission; deferred until Auto-Clean proves itself)
- Out of scope as core product: ad-block suite, password manager, malware AV, VPN

### Phase 2a — Auto-Clean allowlist UI — DONE
Settings editor for `autoCleanAllowlist`: add/remove domains, “Add this site,” domain
normalize on save (same base-domain rules as Auto-Clean) so entries like
`www.tracker.com` / `https://sub.tracker.com/x` match the sweeper. No new permissions.

### Phase 2b — Weekly privacy digest — DONE
On-device weekly aggregates in `chrome.storage.local` (`digest.js`): known-tracker
contact counts, top known-tracker base domains, cookies cleaned by Auto-Clean /
Clean now. Shown on Overview when `weeklyDigestEnabled` (default on). No first-party
browsing hosts stored; no `alarms` permission (week rolls on read/write); nothing uploaded.
