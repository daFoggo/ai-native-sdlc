# Friction log: sdlc 0.5.3 pilot on wattprint (from 2026-11-23)

Same columns as `docs/work/*/friction.md`. Kind: plugin, superpowers, ponytail, session, repo (a repo's own sdlc.json).
Hand-written task rows live in the user's sheet; this file holds what the agent hit and fixed or proposes.

| # | Kind | What happened | Cost | Proposed fix / status |
|---|---|---|---|---|
| P1 | plugin | `denyBash` regexes run over the whole command text, so a read-only command that only *mentions* a banned phrase is refused: the expo onboarding agent's grep, and the main session's own probe loop that listed `pnpm add …` inside a quoted string. | One retry each; the agent has to move test strings into a file | Match against the command with quoted strings and heredoc bodies stripped (keep `bash -c`/`sh -c` bodies), with a test for a banned phrase inside `grep '…'` |
| P2 | plugin (sdlc-init) | The deny pattern sdlc-init wrote for wattprint-expo, `pnpm\s+(add\|install)\s+…`, also refused `pnpm install --frozen-lockfile`; caught only because the main session probed it. | Would block every reinstall in expo | Fixed in the repo (`pnpm\s+add`). sdlc-init step 10: prove each `denyBash` against one legit command beside the banned one |
| P3 | plugin (sdlc-init) | Skills turned off in `settings.local.json` (`skillOverrides: off`: `fastapi` in backend, `wattprint-base` in expo) can still be mapped in `skills`; the guard then refuses an edit the agent cannot satisfy by loading the skill. | One wasted turn per session per skill | Turned the two skills back on (user's choice). sdlc-init and the `start` hook: warn when a mapped skill is off in any settings layer |
| P4 | plugin | On the shared server (load average ~500) expo's verify ran 15 min the first time and 3 jest tests timed out; alone it takes ~76 s. Over `verifyTimeout` the Stop hook only warns, so a slow box degrades to no verify. | Up to 9 min per Stop under load | Watch in the pilot with #9; candidate: a `verifyFast` per changed area |
| P5 | session | Backend `sdlc.json` pointed `debt` at `../wattprint-nextjs/docs/debt.md`, a folder renamed to `wattprint-web`; nothing reported the dead path. | Debt entries would land nowhere | Fixed (backend 6030490). The `start` hook could warn when `debt` or `artifacts` resolves outside an existing folder |
