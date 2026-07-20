# Your Claude Code agent team — setup & first run

This folder contains a ready-to-use single-session agent team for Claude Code,
scoped for a Pro plan. One lead orchestrator delegates to three specialists.

## Files

- `CLAUDE.md` — the lead's operating manual. **Fill in the bracketed sections.**
- `.claude/agents/research-lead.md` — read-only investigator (haiku, cheap)
- `.claude/agents/code-lead.md` — implementer (sonnet, has write + bash)
- `.claude/agents/reviewer.md` — quality gate (sonnet, read-only)

## One-time setup (Windows, native)

1. Install Claude Code in PowerShell:
   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```
   Then close and reopen your terminal (PATH only updates in a new session).
2. Install Git for Windows (recommended — gives the agents a Bash tool).
3. Verify: `claude --version`  and  `claude doctor`
4. Copy this whole folder's contents into your actual project repo root, so that
   `.claude/agents/` and `CLAUDE.md` sit at the top of your project.
5. Edit `CLAUDE.md` and replace every `[bracketed]` placeholder with real details.
   This step matters more than any other — vague context = wasted agent effort.

## Before each long session

- Plug in the laptop and disable sleep/hibernate.
- Use a stable network connection.
- Remember you're on Pro: expect to hit usage limits on long runs. Work in
  phases and let the check-in gates be natural stopping points.

## Running it

From your project root:
```powershell
claude
```

Then paste a kickoff prompt like the one below.

## Starter kickoff prompt

> You're the team lead for this project — see CLAUDE.md for how you run the team
> and your three specialists (research-lead, code-lead, reviewer).
>
> Our goal for this session: [DESCRIBE THE FEATURE / TASK IN 2-4 SENTENCES,
> INCLUDING WHAT "DONE" LOOKS LIKE].
>
> Start by proposing a phased plan — just the plan, no code yet. Break it into
> phases with a clear checkpoint after each. Once I approve the plan, work
> through phase one: research first if needed, then implement, then review, then
> stop and check in with me before phase two.
>
> Escalate to me on any big or irreversible decision per CLAUDE.md. Don't ask me
> about routine details — use your judgment for those.

## Notes

- If Claude can't find a subagent, restart Claude Code — file-based agents load at
  session start.
- Editing an agent `.md` file on disk requires a restart to take effect.
- These same agent files work unchanged as Agent Teams teammates if you later
  upgrade to Max and enable `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Nothing here
  is throwaway.
