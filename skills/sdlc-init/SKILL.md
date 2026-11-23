---
name: sdlc-init
description: Set up a repo for the sdlc process: turn its docs and conventions into machine checks, path-scoped rule cards, a review policy and sdlc.json, for every agent host the team uses (Claude Code, Codex, Antigravity, Gemini CLI). Use when asked to "set up sdlc", "onboard this repo", or when a repo has docs and skills but agents keep missing its standards.
---

# Set up a repo for sdlc

Goal: every standard the repo's docs state is enforced by the cheapest thing that cannot be skipped. Order of
preference for each rule: **linter or type rule → check script → protect/deny/approve in sdlc.json → rule card →
CLAUDE.md or AGENTS.md line**. A rule written as prose is the last resort, because prose is advisory.

Read before writing: the repo's CLAUDE.md / AGENTS.md, every doc they point to, its own skills, its lint and
test config, and recent git history. Do not ask what the repo already answers.

Several repos: one subagent per repo is fine, on a mid-tier model (Claude Code: `model: sonnet`). Onboarding is
reading and mechanical edits; a subagent with no model inherits the session's, often the most expensive, and each
one runs for dozens of turns.

## Steps (audit each before the next)

1. **Inventory.** List every rule the docs and skills state, one line each, with its source. Mark each:
   already enforced (name the lint rule), checkable (a linter or script could catch it), or judgment.
2. **Measure before enforcing.** For each checkable rule, count today's violations (grep or a trial lint run).
   Each one is either fixed to the rule or waived inline with the reason and the doc that allows it. Never ship
   a rule that fails on day one, and never loosen a rule to make it pass.
3. **Make the checkable rules real**, in the repo's own lint config so CI and humans get them too. Keep changes
   to existing code to the fixes from step 2, and restore anything a formatter reflowed that the change did not need.
4. **Rule cards** for the judgment rules: `.claude/rules/<area>.md` (or `.agents/rules/`) with `paths:` globs
   (template: `../sdlc/templates/rule.md`). Claude Code loads them when it touches a matching file; on the other
   hosts the check hook hands them over after the first edit of a matching file, and the review package always
   includes them. Ten lines or fewer each:
   the rules agents miss, and the doc section to open. Never copy a whole doc.
5. **`sdlc.json`** in `.claude/` (Claude-only teams) or `.agents/` (any host; it wins when both exist). Template:
   `../sdlc/templates/sdlc.json`.
   - `verify`: one command, under a few minutes, that never disturbs running dev servers, and that runs every
     fast step the repo's CI runs (read `.github/workflows/` or the CI config: lint, format check, types, i18n or
     other repo scripts, tests). Prefer the script CI itself calls, so the two cannot drift. It runs at every Stop
     that changed the repo, so it must stay fast: a test suite of several minutes belongs in CI, with a fast
     subset here (the Stop hook gives all repos nine minutes together and only warns when they run out). A CI step left out
     (too slow, needs services) is named in CLAUDE.md or AGENTS.md as run by CI only. A failure the agent only
     meets in CI is a missing step here.
   - `artifacts` and `debt`: where this repo already keeps plans or specs and its debt or TODO list (look in docs/
     and the history). Ask only when it has none, then use the defaults (`docs/work`, `docs/debt.md`).
   - `check`: per-file checks fast enough to run after every edit (a single-file lint is ~2 s). A formatter's
     check mode and a line-length rule belong here, so they fail on the edit rather than at the end.
   - `protect` for vendored or generated paths, `denyBash` for commands the docs forbid, `approve` for the paths and
     commands that need a named person (migrations, infra, production deploys), `tests` globs for fix mode,
     `riskyPaths` that force lane L. Secret scanning is on unless `"secrets": false`.
   - `skills` maps code paths to the skills the repo installs for them (`{ "glob": "apps/**/*.tsx", "skill":
     "vercel-react-best-practices" }`): the guard refuses the first edit of a matching file once until the agent
     loads that skill. Map only skills the model can invoke (no `disable-model-invocation: true`; those are
     refused by the host), and only where the skill's own description names that code.
   - Machine-only values (a PATH prefix such as `"pathPrepend": ["~/.local/node/bin"]`) go in
     `sdlc.local.json` beside it, gitignored.
6. **`REVIEW.md`** at the root from `../sdlc/templates/REVIEW.md`, with the repo's vendored paths and what its
   linters already own.
7. **CLAUDE.md / AGENTS.md** stays under a page: commands with an example of healthy output, the verify command,
   a pointer to the sdlc skill and to the docs table. Remove lines that a check from step 3 now enforces. When
   the team uses several hosts, keep one file and point the other at it (`@AGENTS.md` in CLAUDE.md).
8. **Each host the team uses** (the hooks are the same script; only the wiring differs):
   - Claude Code: `/plugin marketplace add daFoggo/ai-native-sdlc`, then enable `sdlc@ai-native-sdlc` in the repo's
     `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`) so teammates get it too.
   - Codex: `codex plugin marketplace add daFoggo/ai-native-sdlc`, `codex plugin add sdlc@ai-native-sdlc`, then
     `/hooks` once to trust them. Codex Cloud and ChatGPT run skills but no hooks: there CI (step 9) is the gate.
   - Antigravity: `agy plugin install https://github.com/daFoggo/ai-native-sdlc`. The snap build runs hooks in its
     own sandbox without your `node`: copy it to `~/snap/antigravity-cli/common/local/bin/node`, and keep repos out
     of hidden folders (snap cannot read them).
   - Gemini CLI: `gemini extensions install https://github.com/daFoggo/ai-native-sdlc`, then merge the plugin's
     `hooks/gemini.json` into the repo's `.gemini/settings.json` (Gemini reads extension hooks only from a path the
     other hosts also auto-load, so they ship as this template).
9. **CI**, the gate no agent can skip and the only one for cloud agents: run the `verify` command in the repo's
   CI if it is not already there. Offer the playbook's other jobs from `../sdlc/templates/ci/`: `pr-review.yml`
   (review against REVIEW.md, @claude fixes), `agent-evals.yml` (real tasks as evals, run when agent config
   changes) and `build-triage.yml`. Closing the loop from production uses `../sdlc/templates/maintain/bands.yaml`.
10. **Prove it.** Run `verify`, and list each CI step beside the part of `verify` that covers it. Trigger each hook once on each host in use: an edit that breaks a check, an edit to
   a protected path, a denied command. Report what fired, and what each host could not do.
