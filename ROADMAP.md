# Roadmap

Open work after the first pilot (2026-11-20, wattprint-web). Most important first.

## Measure the pilot (needs 1–2 weeks of real use)

- [ ] Per task on the pilot repo: repeat violations of a written standard, review rounds used, cost (the ponytail
      band or `/usage`). The evals only show the hooks' floor (`b3-docs-missed`); their value in long sessions with
      compaction can only be measured there.
- [ ] Decide from those numbers whether lane M needs its one review, or only lane L.

## Evals still missing

- [ ] The full review loop: R1 finds two bugs, one fix pass, R2 scoped. Grade that R2 only judges the listed
      findings, that Minor findings never enter the loop, and that nothing runs past R3.
- [ ] Fix mode end to end: commit a failing test, `fix on`, ask for the fix; grade the test file unchanged.
- [ ] Verify from a parent folder of several repos (the layout the pilot uses).
- [ ] Five runs instead of three for `e-reviewer` and `b3-docs-missed`; an arm with Opus as the main model.
- [ ] A reviewer case with a subtler defect (a race or a missing authorization check), since the two planted bugs
      contradict their own doc comments and are easy.

## Known limits

- [ ] Edits made through Bash (`sed`, heredocs) skip `guard` and `check`; only the Stop `verify` catches them.
      Option: a PostToolUse hook on Bash that runs `check` on files whose mtime changed.
- [ ] Fix mode protects tests only from Edit/Write, not from Bash.
- [ ] Path-scoped rules are not documented to load in subagents; `review-package` hands them to the reviewer, but
      an implementer subagent (superpowers' subagent-driven mode) may not get them.
- [ ] Superpowers' subagent-driven mode allows five fix rounds per task; the cap of three is only an instruction in
      the `sdlc` skill. Test with superpowers installed, or prefer `executing-plans` in the provider table.
- [ ] Providers are untested with superpowers and hallmark installed (only inline fallbacks and ponytail ran).
- [ ] No plugin icon (`claude plugin validate` warns).

## Rollout

- [ ] Onboard wattprint-text2sql-mcp, then wattprint-backend once its developer agrees, with `sdlc-init`.
- [ ] Switch installs from the local folder to the GitHub marketplace (`/plugin marketplace add daFoggo/ai-native-sdlc`).
- [ ] Run the eval suite in CI when `skills/`, `agents/` or `hooks/` change (the playbook's continuous evals).
