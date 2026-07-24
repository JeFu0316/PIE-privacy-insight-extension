# Toolingo / P.I.E — agent setup & project pointer

Vanilla Manifest V3 Chrome extension. Public brand: **Toolingo** (Privacy Insight).

## Current status

- Code version **2.1.0** — feature inventory and progress: **[FINDINGS_PIE.md](FINDINGS_PIE.md)**
- Store / privacy compliance gate: **[PUBLISH_CHECKLIST.md](PUBLISH_CHECKLIST.md)**
- How the lead runs specialists: **[CLAUDE.md](CLAUDE.md)**

## Agent team files

- `CLAUDE.md` — lead operating manual
- `.claude/agents/research-lead.md` — read-only investigator
- `.claude/agents/code-lead.md` — implementer
- `.claude/agents/reviewer.md` — quality gate

## One-time setup (Windows)

1. Install Claude Code (PowerShell): `irm https://claude.ai/install.ps1 | iex` then reopen the terminal.
2. Install Git for Windows.
3. Verify: `claude --version` and `claude doctor`
4. Work from this repo root so `.claude/agents/` and `CLAUDE.md` load.

## Starter kickoff prompt

> You're the team lead — see CLAUDE.md. Product status and shipped features are in FINDINGS_PIE.md; store blockers in PUBLISH_CHECKLIST.md.
>
> Goal for this session: [TASK]. Propose a short plan, then implement only after I approve if the task crosses a CLAUDE.md escalation gate.

## Notes

- Privacy policy / Support page live outside this repo: `C:\PIE-privacy-site` (GitHub Pages).
- Packaged zip for CWS: `dist/pie-2.1.0.zip` (gitignored). Rebuild after shipping changes.
- Restart Claude Code after editing agent `.md` files on disk.
