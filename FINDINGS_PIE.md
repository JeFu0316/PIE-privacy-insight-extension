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

### Themes (research-informed)
Developer theme preferences cluster around a small, well-loved set. Recommended
starter pack: Dark (current), Light, plus 2–3 crowd favourites in the style of
Catppuccin (soft pastel, "pick of 2026"), Dracula (strong colour separation), and
Nord/Tokyo Night (calm blue-toned). Include at least one accessibility/colour-blind
friendly option (GitHub-style themes are noted for colour-blind support).
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

### #2 Block cookie banners — DESCOPE OR DEFER (honest recommendation)
Detecting banners (current MutationObserver) is easy. Reliably BLOCKING/dismissing
them is a whole product — the tools that do it well rely on large community rule
sets, and MV3 constrains the network-level approach (see 1a). 
Options, cheapest first:
  (a) Cosmetic auto-hide of detected banners via CSS injection (brittle, may hide
      wrong elements) — a "best effort" toggle, clearly labelled.
  (b) Bundle/consume an existing open ruleset — licensing + maintenance burden.
  (c) Defer to a later release.
Recommendation: ship (a) as an optional, clearly-labelled "best effort" feature at
most; treat full blocking as out of scope for this update.

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
   banner hide (#2, if approved). **Bulk delete done; banner hide pending.**

Each phase ends with a review pass and a check-in before the next begins.

## Open questions for you
- Banner blocking: descope to optional "best-effort hide", or defer entirely?
- IP/DNS lookup: keep (disclosed), make optional, or remove?
- Version bump target: is this a 3.0?
