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
- [x] Fix mode end to end (`g-fix-mode`, 3/3 with Bash): commit a failing test, `fix on`, ask for the fix; grade the test file unchanged.
- [x] A parent folder of several repos (`h-parent-folder`, 3/3).
- [x] Runs with Bash granted (bubblewrap + socat). The eval sandbox is read-only to Bash, so shell edits are covered by
      `evals/manual/bash-edit.sh` (3/3 with the plugin, 0/3 without).
- [x] Review cannot converge (`i-review-stuck`, 3/3): the agent stops after R1 and hands the ruling over.
- [x] A third round ran (`integrations.sh superpowers-L`): R1 and R2 found Musts, R3 passed, the loop stopped.
- [ ] Five runs instead of three for `e-reviewer` and `b3-docs-missed`; an arm with Opus as the main model.
- [ ] A reviewer case with a subtler defect (a race or a missing authorization check), since the two planted bugs
      contradict their own doc comments and are easy.

## Known limits

- [x] Edits made through Bash (`sed`, heredocs) skipped `check` (0.1.1: the `bash` hook checks files the command
      changed; more than 20 changed files are left to `verify`).
- [x] Fix mode protected tests only from Edit/Write (0.1.1: a test changed through Bash is reported after the
      command, not prevented).
- [x] Path-scoped rules load in subagents (`integrations.sh rules`).
- [ ] Superpowers' subagent-driven mode allows five fix rounds per task; the cap of three is only an instruction in
      the `sdlc` skill. Test with superpowers installed, or prefer `executing-plans` in the provider table.
- [x] Providers tested with superpowers 7.0.2 and hallmark 2.0.0 installed (`integrations.sh`). Found and fixed: lane M
      skipped review as "too small", and installed providers were never invoked (0.2.0).
- [ ] In `claude -p`, the reviewer runs in the background and the session ends before its findings arrive; interactive
      sessions and `claude plugin eval` wait for it. Check whether headless use (CI) needs a foreground reviewer.
- [x] Plugin icon.

## Rollout

- [ ] Onboard wattprint-text2sql-mcp, then wattprint-backend once its developer agrees, with `sdlc-init`.
- [x] Installs come from the GitHub marketplace; wattprint-web declares it in `.claude/settings.json`.
- [ ] Run the eval suite in CI when `skills/`, `agents/` or `hooks/` change (the playbook's continuous evals).
