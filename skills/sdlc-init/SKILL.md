---
name: sdlc-init
description: Set up a repo for the sdlc process: turn its docs and conventions into machine checks, path-scoped rule cards, a review policy and .claude/sdlc.json. Use when asked to "set up sdlc", "onboard this repo", or when a repo has docs and skills but agents keep missing its standards.
---

# Set up a repo for sdlc

Goal: every standard the repo's docs state is enforced by the cheapest thing that cannot be skipped. Order of
preference for each rule: **linter or type rule → check script → protect/deny in sdlc.json → rule card →
CLAUDE.md line**. A rule written as prose is the last resort, because prose is advisory.

Read before writing: the repo's CLAUDE.md / AGENTS.md, every doc they point to, its own skills, its lint and
test config, and recent git history. Do not ask what the repo already answers.

## Steps (audit each before the next)

1. **Inventory.** List every rule the docs and skills state, one line each, with its source. Mark each:
   already enforced (name the lint rule), checkable (a linter or script could catch it), or judgment.
2. **Measure before enforcing.** For each checkable rule, count today's violations (grep or a trial lint run).
   Each one is either fixed to the rule or waived inline with the reason and the doc that allows it. Never ship
   a rule that fails on day one, and never loosen a rule to make it pass.
3. **Make the checkable rules real**, in the repo's own lint config so CI and humans get them too. Keep changes
   to existing code to the fixes from step 2, and restore anything a formatter reflowed that the change did not need.
4. **Rule cards** for the judgment rules: `.claude/rules/<area>.md` with `paths:` globs (template:
   `../sdlc/templates/rule.md`). They load when Claude reads or edits a matching file. Ten lines or fewer each:
   the rules agents miss, and the doc section to open. Never copy a whole doc.
5. **`.claude/sdlc.json`** (template: `../sdlc/templates/sdlc.json`):
   - `verify`: one command, under a few minutes, that never disturbs running dev servers.
   - `check`: per-file checks fast enough to run after every edit (a single-file lint is ~2 s).
   - `protect` for vendored or generated paths, `denyBash` for commands the docs forbid, `tests` globs for fix mode,
     `riskyPaths` that force lane L.
   - Machine-only values (a PATH prefix such as `"pathPrepend": ["~/.local/node/bin"]`) go in
     `.claude/sdlc.local.json`, gitignored.
6. **`REVIEW.md`** at the root from `../sdlc/templates/REVIEW.md`, with the repo's vendored paths and what its
   linters already own.
7. **CLAUDE.md** stays under a page: commands, the verify command, a pointer to the sdlc skill and to the docs
   table. Remove lines that a check from step 3 now enforces.
8. **Prove it.** Run `verify`. Trigger each hook once: an edit that breaks a check, an edit to a protected path,
   a denied command. Report what fired.
