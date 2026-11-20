# Roadmap

Open work after the first pilot (2026-11-20, wattprint-web). Most important first.

## Measure the pilot (needs 1–2 weeks of real use)

- [ ] Per task on the pilot repo: repeat violations of a written standard, review rounds used, cost (the ponytail
      band or `/usage`). The evals only show the hooks' floor (`b3-docs-missed`); their value in long sessions with
      compaction can only be measured there.
- [ ] Decide from those numbers whether lane M needs its one review, or only lane L.

## Evals still missing

- [x] The full review loop (`f-review-loop`, 3/3, two rounds each): R1 finds two bugs, one fix pass, R2 scoped. Grade that R2 only judges the listed
      findings, that Minor findings never enter the loop, and that nothing runs past R3.
- [x] Fix mode end to end (`g-fix-mode`; rerun once to confirm the reworded grader): commit a failing test, `fix on`, ask for the fix; grade the test file unchanged.
- [x] A parent folder of several repos (`h-parent-folder`, 3/3).
- [ ] Runs with Bash granted (needs a sandbox backend, e.g. bubblewrap on Linux): the `bash` hook and the reviewer's git commands are untested inside evals.
- [ ] A loop case where R2 still finds a Must, to see R3 run and then a stop with rulings handed to the user.
- [ ] Five runs instead of three for `e-reviewer` and `b3-docs-missed`; an arm with Opus as the main model.
- [ ] A reviewer case with a subtler defect (a race or a missing authorization check), since the two planted bugs
      contradict their own doc comments and are easy.

## Known limits

- [x] Edits made through Bash (`sed`, heredocs) skipped `check` (0.1.1: the `bash` hook checks files the command
      changed; more than 20 changed files are left to `verify`).
- [x] Fix mode protected tests only from Edit/Write (0.1.1: a test changed through Bash is reported after the
      command, not prevented).
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
