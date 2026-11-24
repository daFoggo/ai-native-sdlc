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
- [x] Superpowers' subagent-driven mode allows five fix rounds per task; the cap of three was only an instruction in
      the `sdlc` skill (0.4.5: the guard hook refuses that skill unless `providers.build` names it).
- [ ] Run `e-reviewer` with the reviewer on `sonnet` to back lane M's R1 on the mid tier with numbers.
- [x] Providers tested with superpowers 7.0.2 and hallmark 2.0.0 installed (`integrations.sh`). Found and fixed: lane M
      skipped review as "too small", and installed providers were never invoked (0.2.0).
- [ ] In `claude -p`, the reviewer runs in the background and the session ends before its findings arrive; interactive
      sessions and `claude plugin eval` wait for it. Check whether headless use (CI) needs a foreground reviewer.
- [x] Plugin icon.

## Other agent hosts (0.3.0)

- [x] One hooks script with per-host output (`HOSTS`), one skills folder, one reviewer prompt; manifests for Codex,
      Antigravity and Gemini CLI. Codex payloads captured from a real run (`hooks/fixtures/codex/`).
- [ ] Codex end to end: install from GitHub, trust the hooks, run the `b3-docs-missed` task with and without.
      Known: `codex exec` needs `--trust` (project config) and `--dangerously-bypass-hook-trust` (unreviewed hooks).
- [x] Antigravity end to end (`agy` 1.4.12): payloads captured (`hooks/fixtures/antigravity/`); tool events are
      grouped and the others flat; `{}` or silence from PreToolUse denies, so guard answers `ask`; check failures
      reach the model through PostInvocation. Found while testing: the eval scaffolds' verify (`check.sh -r src`)
      always passed, so earlier evals never exercised the Stop gate (fixed in 0.3.1).
- [ ] Gemini CLI end to end (not installed here): the hooks template and `${extensionPath}`-free paths.
- [ ] Codex custom agent (`.codex/agents/reviewer.toml` with `model`) written by `sdlc-init`, if the generic
      subagent reviews worse than the Claude agent on `e-reviewer`.

## Playbook coverage still open

- [x] Secrets kept out of the diff (guard), approval gates (`approve` → ask), record-ID linkage in templates, the
      "second mistake goes into CLAUDE.md/AGENTS.md" rule, CI templates, `bands.yaml`, git metrics.
- [ ] A hook that keeps `plan.md` in step with the diff (the playbook suggests one; today it is an instruction).
- [ ] A verifier subagent that runs the app and checks behavior against `plan.md` before done.
- [ ] Spec generation triggered by an accepted `intent.md` (a CI job on merge), and the managed-settings example.

- [x] Writes that bypass the file tools: a subagent or MCP tool now gets the after-tool check (0.3.2). Left: Codex's
      hosted tools skip hooks by design, and edits made outside the agent (an editor) are seen only by Stop verify.

## Debt from the independent review (R1, 0.3.2 → 0.4.0)

Must and Should findings were fixed in 0.4.0. Minor ones, kept here:
- [x] Claude's after-edit `check` matcher leaves out `NotebookEdit` (guarded, not checked).
- [x] A rule card with CRLF line endings loses its `paths:` and binds every file (`rulePaths` splits on `\n`).
- [x] The Stop `blocks` counter resets only on a green run, so after three early failures later tasks only warn.
- [ ] Gemini hooks hardcode `~/.gemini/extensions/sdlc/` and have no captured payloads.
- [ ] The role table names hallmark for `ui-new` "never on an existing design system", yet the pilot repo has one:
      say instead that the repo's design docs win and hallmark only fills what they leave open.
- [ ] ponytail switches itself on through its own hook whatever `providers.style` says: document it as the one
      provider that is not swappable per repo.
- [x] Unit tests still leave `sdlc-state-*`/`sdlc-none-*` temp folders.

## Debt from skill routing (0.4.11, docs/work/2026-11-23-skill-routing)

- [x] Capture real Claude Code payloads (`hooks/fixtures/claude/`): a Skill call (`tool_input.skill`) and an edit
      inside a subagent (`agent_id`). Docs list `agent_id`, but no fixture proves it; without it subagents share `main`. Verified live in a Claude Code session (main and a subagent get separate keys); no fixture file captured.
- [ ] Save a real Skill call and a subagent edit as fixture files in `hooks/fixtures/claude/` (behavior verified live, files not captured).
- [x] A test that two sessions keep separate loaded state (R1 Minor 3).
- [x] A Skill call from a cwd outside any sdlc repo is not recorded, so the gate asks once more (R2 Minor). Ruling (0.5.3): kept. Recording there would write a seen file for every session on the machine (R1-2); the cost is one extra refusal that passes on retry.
- [ ] Gemini and Antigravity skill activation does not satisfy the gate; capture their activation payloads.
- [x] Change 2: `business-map` skill and the review package's "flows touched" section (0.5.0).
- [x] review-package reads sdlc.json without `sdlc.local.json` (a near-copy of the hooks' `loadConfig`); a non-string `map` crashes it. Move `loadConfig` next to `matchingRules` and import it in the hooks.
- [x] The package reads the business map from the working tree, also for an older `<base> <head>` range.
- [ ] Friction items still open in `docs/work/2026-11-23-skill-routing/friction.md` (see its Status): 7, 9, 12.
- [ ] A killed `npm test` process skips `test-tmp.mjs`'s exit handler and leaves its temp folder (low).

## Rollout

- [ ] Onboard wattprint-text2sql-mcp, then wattprint-backend once its developer agrees, with `sdlc-init`.
- [x] Installs come from the GitHub marketplace; wattprint-web declares it in `.claude/settings.json`.
- [ ] Run the eval suite in CI when `skills/`, `agents/` or `hooks/` change (the playbook's continuous evals).

## Deferred from the 0.4.3 review (Minor)

- sdlc-init: the formatter `check` glob must cover the files the CI formatter checks (markdown too); verify skips
  docs-only turns, so a README-only edit can pass locally and fail CI.
- SKILL.md bug-fix input list lacks "or the code that produces it", which the reviewer accepts.
- SKILL.md "a repo's own templates in that folder win" does not say where to look.
- `templates/ci/pr-review.yml` and `templates/maintain/bands.yaml` still hardcode `docs/work`.
- `start` says "sdlc.json unreadable" also when only `sdlc.local.json` is broken; guard, check and verify still let a
  broken config throw (visible error, but for that repo only checked by hand).

## Deferred from the 0.5.6 review (Minor)

- `configProblems`: an in-repo folder named `..foo` counts as outside the repo; an absolute `debt`/`artifacts` on another
  Windows drive is not checked (a missed warning only).
