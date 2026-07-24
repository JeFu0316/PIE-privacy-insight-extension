# Toolingo 2.1.0 — Chrome Web Store publish checklist

Use this when packaging or updating the **existing** listing (do not publish a duplicate extension).  
Feature inventory: [FINDINGS_PIE.md](FINDINGS_PIE.md).

## Package

Rebuild zip from runtime files only → `dist/pie-2.1.0.zip`.

**Include:**  
`manifest.json`, `background.js`, `content_script.js`, `popup.html`, `popup.css`, `popup.js`,  
`settings.js`, `i18n.js`, `exit-ip.js`, `digest.js`, `reports.js`, `block-stats.js`,  
`clean-urls.js`, `ai-explain.js`, `cookie-database.js`, `tracker-domains.js`,  
`COOKIE_DB_LICENSE.txt`, `toolingo-mark.png`, `toolingo16/32/48/128.png`,  
`toolingo*-darkui.png`, `offscreen-icon-theme.html`, `offscreen-icon-theme.js`

**Exclude:**  
`.git/`, `.claude/`, `CLAUDE.md`, `FINDINGS_PIE.md`, `README.md`, `PUBLISH_CHECKLIST.md`,  
`prototype/` (removed), `tests/`, `dist/`, legacy `pie*.png` (removed)

## Privacy practices — permission justifications (paste)

### declarativeNetRequest
```
Blocks third-party requests to a bundled, on-device list of known tracker domains when the user opts in via Settings → “Block known trackers (network).” First-party requests are never blocked. Rules are cleared when the setting is turned off. No browsing data leaves the device.
```

### offscreen
```
Creates a small offscreen document solely to detect the system color scheme (prefers-color-scheme) so the toolbar icon can switch between light and dark glyphs for visibility. No page content, cookies, or browsing data are accessed or transmitted.
```

### Also justify (existing)
- **cookies** — Read/delete cookies for the active site for PII/tracker insight and user-requested cleanup.
- **tabs** — Read the active tab URL to scope analysis and HTTPS status.
- **webRequest** — Observe request metadata (non-blocking) for third-party cookies and the Network tab. No modification.
- **storage** — Persist settings and on-device digest/report data.
- **notifications** — Optional alert when a site sets third-party cookies.
- **host / content script `<all_urls>`** — Analyze the site the user is viewing; optional best-effort consent-banner CSS hide.

## Disclosures to keep accurate

- **Single purpose:** Insight into cookie usage, third-party tracking, and connection security (optional on-device protections).
- **On-device:** Cookie/PII/tracker analysis, network log, digest, DNR rules — no upload of cookies or browsing history.
- **Optional off-device:** Site IP (Google DNS), public IP (Cloudflare) — both off by default.
- **User-initiated feedback:** Formspree (`formspree.io`) — topic/url/details/version/locale only.
- **AI Explain:** Chrome built-in on-device LanguageModel only; structured findings, no cookie values in prompts; off by default / beta-gated.
- **DNR:** Opt-in; third-party known trackers only; bundled static list.
- **Support page:** https://jefu0316.github.io/Index.html/support.html (Ko-fi); not part of the CRX package.

## Pre-submit checklist

- [ ] Privacy policy linked in dashboard (Toolingo-branded)
- [ ] Privacy practices / Limited Use completed
- [ ] New permission justifications entered (DNR + offscreen)
- [ ] Store name / description / screenshots match Toolingo 2.1.0
- [ ] Zip contains only runtime files; version `2.1.0`
- [ ] Manual smoke: Load unpacked → Overview / Cookies / Security / Network / Settings / Support heart

## Decisions already made

- Update existing listing (2.0.x → 2.1.0), not a new v1.0 listing.
- Keep optional IP lookups (off by default), disclosed in policy.
- Banner feature = best-effort hide only (not full blocking).
