# Toolingo — Status & Feature Inventory

**Source of truth for agents and humans.** Read this first; do not re-analyse git history to catch up.

| Field | Value |
|-------|--------|
| **Product** | Toolingo (Privacy Insight) — formerly P.I.E |
| **Code version** | `2.1.0` (`manifest.json`) |
| **Branch** | `feature/toolingo-2.1.0-phase2` |
| **Stack** | Vanilla JS, Manifest V3, no bundler |
| **Privacy policy** | https://jefu0316.github.io/Index.html/ |
| **Support / donate** | https://jefu0316.github.io/Index.html/support.html (Ko-fi widget) |
| **Package zip** | `dist/pie-2.1.0.zip` (rebuild after code changes) |

## Current status

- **Code:** Feature-complete for the 2.1.0 roadmap (Phases 1–6 below).
- **Store:** Preparing / updating the existing CWS listing (not a new extension). New permissions need justifications: `declarativeNetRequest`, `offscreen`.
- **Hard rules:** Privacy-first (no cookie/browsing upload). No destructive git. No new external network calls without approval. Idea #2 full banner *blocking* stays deferred — only best-effort CSS hide shipped.

---

## Implemented features

### Insight (core)
| Feature | Notes | Default |
|---------|--------|---------|
| Cookie list + detail | Active-site cookies via `chrome.cookies` | Always |
| Two-axis scoring | **Sensitivity** (PII) vs **Tracking** (bundled cookie DB) — not one blended score | Always |
| PII detection | Email, phone, JWT, UUID, Luhn cards, high-entropy tokens + benign-name dampening | Always |
| Third-party cookie detection | `webRequest` observe-only + optional desktop notification | Notifs on |
| HTTPS / connection status | Site bar + Security tab | Always |
| Cookie attribute warnings | Missing Secure / HttpOnly, weak SameSite, etc. | Always |
| Consent banner detection | Content-script MutationObserver | Always |
| Network activity log | Metadata only (on-device); filter by type | Monitoring on |
| Weekly privacy digest | Aggregate tracker contacts + cleaned counts (`digest.js`) | On |
| Tracker count toolbar badge | Known trackers contacted this tab | On |

### Protect (mostly opt-in)
| Feature | Notes | Default |
|---------|--------|---------|
| Auto-hide cookie banners | Best-effort CSS hide — does **not** reject cookies | Off |
| Auto-clean tracker cookies | On tab close; never first-party/login; allowlist UI | Off |
| Clean tracker cookies now | Manual button | — |
| Block known trackers | `declarativeNetRequest`, third-party only + page/lifetime stats | Off |
| Clean URL | Strip tracking params from current URL (manual) | Button on |
| Fingerprint detection | Canvas / audio API call counts | On |
| Fingerprint noise shield | Best-effort canvas noise | Off |
| AI privacy explain | Chrome on-device Prompt API; structured findings only; beta-gated | Off |

### Optional lookups (off-device when enabled)
| Feature | Notes | Default |
|---------|--------|---------|
| Show site IP | Google DNS hostname resolve | Off |
| Show my public IP | Cloudflare trace + best-effort PTR / VPN hint | Off |

### UI & product
| Feature | Notes |
|---------|--------|
| Tabs | Overview · Cookies · Security · Network |
| Settings panel | Themes, language, toggles, allowlist, beta gate |
| Themes | System, Light, Dark, Catppuccin, Dracula, Nord, Colour-safe, Custom |
| Background FX | Off / Aurora / Particles / Shimmer + smooth animations |
| Toolbar icon lines | Light / Dark / Auto (`offscreen` + `offscreen-icon-theme.*`) |
| Languages | en, zh_CN, zh_TW, ru, es, fr, de, pt_BR, ja, ko (`i18n.js`) |
| Report / feedback | In-app form → Formspree + on-device copy (`reports.js`) |
| Terms & clarity | In-popup explanations + policy link |
| Support | Heart menu → panel → GitHub Pages + Ko-fi |

---

## Runtime file map

| File | Role |
|------|------|
| `manifest.json` | MV3; permissions include cookies, tabs, webRequest, storage, notifications, declarativeNetRequest, offscreen |
| `background.js` | SW: HTTPS/third-party, badge, auto-clean, DNR, notifications |
| `content_script.js` | Banner detect/hide, fingerprint watch/shield |
| `popup.html` / `popup.css` / `popup.js` | UI + scoring (`detectPII`, `calculateOverallRisk`) |
| `settings.js` | `chrome.storage.sync` schema |
| `i18n.js` | In-app locales |
| `cookie-database.js` + `COOKIE_DB_LICENSE.txt` | Bundled cookie classifications |
| `tracker-domains.js` | Known tracker / ad domains |
| `digest.js` | Weekly aggregates |
| `exit-ip.js` | Optional public IP |
| `reports.js` | Feedback store + Formspree sync |
| `clean-urls.js` | Tracking-param strip |
| `block-stats.js` | Block counters |
| `ai-explain.js` | On-device AI explain wrapper |
| `offscreen-icon-theme.html/js` | Color-scheme for Auto toolbar icon |
| `toolingo*.png` | Icons (incl. `*-darkui` for dark toolbars) |

**Tests:** `tests/*.test.js` (settings, scoring, clean-urls, digest, exit-ip, i18n, network). No full automated UI suite — still verify via Load unpacked.

**Docs for agents:** `CLAUDE.md` (how to run the team), this file (what exists), `PUBLISH_CHECKLIST.md` (store ship gate).

**Privacy policy repo (sibling):** `C:\PIE-privacy-site` → https://github.com/JeFu0316/Index.html

---

## Out of scope / deferred

| Item | Status |
|------|--------|
| Full cookie-banner blocking / “reject all” automation | Deferred — do not build without explicit approval |
| Auto Clean-URL via DNR `queryTransform` | Deferred (manual Clean URL only) |
| Full ad-block suite / VPN / malware AV | Out of product scope |
| Toolingo Vault (passwords) | Separate product later — not in this extension |
| Google DNS / Cloudflare lookups removal | Optional features kept off by default; disclosed in policy |

---

## Agent handoff checklist

1. Read **this file** + `CLAUDE.md`.
2. For store work, use `PUBLISH_CHECKLIST.md`.
3. After code changes that ship, rebuild `dist/pie-2.1.0.zip` (runtime files only — see checklist).
4. Do not resurrect deleted legacy `pie16/32/128.png` or `prototype/` — Toolingo icons are current.
5. Pause for human go on: new permissions, new external network calls, version bump to published store, build tooling.
