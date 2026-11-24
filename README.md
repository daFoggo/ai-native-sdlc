# ai-native-sdlc

A plugin for Claude Code, Codex, Antigravity and Gemini CLI that runs the [AI-Native SDLC Playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook)
in any repo: work goes through lanes from intent to merge, review stops after three rounds, and each project's own
standards are enforced by hooks instead of being left to the agent's memory.

It does not replace your other skills. It names **roles** (intent, spec, plan, build, style, review, ui-new, debug)
and lets each repo pick the skill that fills them, so [superpowers](https://github.com/obra/superpowers),
[ponytail](https://github.com/DietrichGebert/ponytail) or [hallmark](https://github.com/Nutlope/hallmark) can be
swapped by editing one line.

## Why

Agents miss a project's standards for three reasons, and each has a mechanical fix:

| Why standards get missed | What this plugin does |
|---|---|
| Docs are read only when the agent thinks of it | Path-scoped rule cards (`.claude/rules/*.md` with `paths:`) load when a matching file is touched (on hosts without path rules, the check hook hands them over); the review package hands the same cards to the reviewer |
| A rule written as prose cannot be enforced | `sdlc-init` turns every checkable rule into a lint rule or script; a hook runs it on each edited file and stays silent when it passes |
| "Done" is claimed without running anything | A Stop hook runs the project's verify command in each repo this session changed since the last green run; a verify that runs out of time warns instead of blocking |

Review is capped at three rounds (one full review, then at most two reviews of the fix only). Superpowers' own
measurements found that unbounded loops are the biggest source of cost variance, that re-reviewing the whole diff
each round keeps producing new findings instead of converging, and that cheap reviewer models miss planted
defects. So the first review of a large or risky change runs on the most capable model (the reviewer agent's
default), the first review of a change inside one area and the re-reviews on a mid-tier model, never the cheapest,
and re-reviews look only at the fix.

The plugin cannot pick the main session's model, which does most of the work (plan, code, reading). A mid-tier
model is enough for most sessions; switch to the most capable one for lane L design.

## Install

| Host | Install | Notes |
|---|---|---|
| Claude Code | `/plugin marketplace add daFoggo/ai-native-sdlc` then `/plugin install sdlc@ai-native-sdlc` | Everything below works |
| Codex (CLI, desktop) | `codex plugin marketplace add daFoggo/ai-native-sdlc` then `codex plugin add sdlc@ai-native-sdlc`; trust the hooks once with `/hooks` | Same hooks file as Claude. No reviewer agent file (Codex plugins cannot ship one): the skill starts a fresh subagent with `skills/sdlc/references/reviewer.md`. Codex Cloud runs skills, not hooks |
| Antigravity | `agy plugin install https://github.com/daFoggo/ai-native-sdlc` | Run end to end with `agy` 1.4.12: the SessionStart pointer, guard, per-edit check and Stop verify all fire. Its PostToolUse can only answer `{}`, so a failed check is held and injected by the PostInvocation hook before the next model call. Its PreToolUse must decide; with nothing to block, guard answers `ask` (the normal permission flow). The snap build cannot see your `node`: copy it to `~/snap/antigravity-cli/common/local/bin/node` |
| Gemini CLI | `gemini extensions install https://github.com/daFoggo/ai-native-sdlc`, then merge `hooks/gemini.json` into `.gemini/settings.json` | Gemini auto-loads `hooks/hooks.json`, a path Claude and Codex also read, so its hooks ship as a template. **Not yet run end to end** |

The plugin does nothing in a repo until that repo has an `sdlc.json` (in `.agents/` or `.claude/`). Run the
`sdlc-init` skill in a repo to create it. Needs Node 22.5 or later (`path.matchesGlob`).

### Adding another host

Every host reads the same `skills/` (the SKILL.md standard) and calls the same `hooks/sdlc.mjs`. A new host needs:
a manifest in the layout that host expects; a hooks file that calls `node <root>/hooks/sdlc.mjs <mode> <host>`; an
entry in `HOSTS` in `hooks/sdlc.mjs` (how that host wants a context line, a deny, a block); and, if its file tools
have new names, a line in `EDIT_TOOLS`/`SHELL_TOOLS`. Capture a real payload with a probe hook and add it under
`hooks/fixtures/<host>/`; `hooks/hosts.test.mjs` keeps versions and hook files in step. Never ship
`hooks/hooks.json`: several hosts auto-load it with different event names.

## What is inside

| Part | What it does |
|---|---|
| `skills/sdlc` | The process: lanes S/M/L, artifacts (`intent.md`, `spec.md`, `plan.md`), the review loop, the definition of done, the role → provider table |
| `skills/sdlc-init` | Onboards a repo: inventory the docs' rules, measure violations, enforce what a machine can, write rule cards, `sdlc.json`, `REVIEW.md` |
| `skills/business-map` | `/business-map`: an evidence-linked map of the business flows (`map.json`, checked and rendered to one HTML page by `scripts/render.mjs`) for BA, testers and devs; each step says whether it was read in code, stated by a doc, guessed or proven |
| `skills/sdlc/references/reviewer.md` | The reviewer's instructions, one copy for every host: full and scoped modes; every finding needs a concrete failing case. `claude/agents/reviewer.md` is the same text as a Claude agent on the most capable model |
| `hooks/sdlc.mjs` | `start` (points the agent at the skill in opted-in repos), `guard` (protected paths, banned commands, secrets in new content, read-only tests in fix mode, `approve` gates, the first edit of a file mapped to a skill not yet loaded), `check` (per-file check after each edit), `bash` (after a shell command, subagent or MCP tool: the same check on the files it wrote, plus protected and test paths it changed, moved, deleted or committed (its own commits, not those a merge, pull or checkout brings in); a shell command cannot be inspected beforehand, so this reports after the fact and the agent restores the file), `verify` (on Stop). One script; `HOSTS` adapts its output to each agent |
| `skills/sdlc/scripts/metrics.mjs` | The playbook's indicators from git: intent → spec → plan times, spec rework after the plan, agent-instruction and rule-card changes, debt added |
| `skills/sdlc/templates/ci/`, `maintain/` | The playbook's CI jobs (PR review with claude-code-action, continuous agent evals, build triage) and the closing-the-loop `bands.yaml` |
| `skills/sdlc/scripts/review-package.mjs` | One file per review: commits, stat, the rule cards that bind the changed files, and the diff (5 lines of context; lockfiles and other huge diffs listed, not inlined). `--since <snapshot>` packages only the fix for a scoped R2/R3 |

## `sdlc.json` (`.agents/` or `.claude/`)

```json
{
  "verify": "pnpm check",
  "check": [{ "glob": "apps/web/**/*.{ts,tsx}", "cwd": "apps/web", "run": "pnpm exec eslint --max-warnings 0 {file}" }],
  "protect": [{ "glob": "packages/ui/src/components/ui/**", "reason": "vendored shadcn: change tokens or props", "via": "shadcn(@\\S+)? add" }],
  "denyBash": [{ "pattern": "npm install", "reason": "this repo uses pnpm" }],
  "approve": [{ "glob": "db/migrations/**", "reason": "migrations need a change ticket from the DBA" }],
  "tests": ["**/*.test.{ts,tsx}"],
  "riskyPaths": ["**/auth/**"],
  "providers": { "style": "ponytail:ponytail" },
  "models": { "implementer": "sonnet", "planner": "sonnet" },
  "skills": [{ "glob": "apps/web/**/*.tsx", "skill": "vercel-react-best-practices" }],
  "map": "docs/business-map"
}
```

`map` names the folder of the business map that `/business-map` builds (`map.json`, rendered to `index.html` by
its script): each business step links to the code, doc or test that shows it. The review package then lists the
steps whose evidence a change touched (`## Flows touched`) and evidence files that are gone, and a lane L spec reads
those steps into its Areas of concern. The package lists files under `artifacts` instead of inlining them: the
spec and plan reach the reviewer by path.

`skills` routes code to the skills a repo installs for it: skills load from a one-line description among many, so
agents often skip them. The guard refuses the first edit of a matching file until that skill is loaded (a Skill
call, plain or `plugin:name`), once per skill and per subagent, so the next edit always passes. On hosts with no
skill event (Codex) the refusal works as a reminder.

`models` maps a subagent type to the model it runs on. On Claude Code the guard hook rewrites every `Agent` call
that names that type, so the choice holds on every machine instead of depending on the agent passing `model`.
Without a map, only one floor applies: `sdlc:reviewer` never runs on `haiku`. The same hook refuses
`superpowers:subagent-driven-development` unless `providers.build` names it.

`sdlc.local.json` beside it (gitignored) adjusts it per machine: lists add to the team's (`"pathPrepend":
["~/.local/node/bin"]`, an extra ban), other values replace them. `pathPrepend` reaches only the hooks' own
commands, not the agent's shell. A `protect` entry's optional `via` is a pattern for the shell command allowed to
write there (the vendored set's update script); a command that rewrites a protected file unchanged is not reported.
`approve` asks a person through the host's permission prompt; in a session that runs with prompts bypassed
(`bypassPermissions`) it stays silent, since that user chose not to be asked. `deny`, `protect` and secrets still block.
At session start the hook reports config that can never work (a `debt` or `artifacts` folder that is gone, a `map`
without map.json, an unknown key, a mapped skill that `skillOverrides` turns off); a healthy config adds nothing.
Why the hooks are built this way: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
In a folder that holds several repos, the Stop hook verifies each child repo with its own `sdlc.json` that the
session changed. Secret
scanning (keys and tokens written into tracked files) is on unless `"secrets": false`.

## Evals

Latest numbers are in [evals/RESULTS.md](evals/RESULTS.md) (raw runs stay local in `evals/results/`). In short, on
0.3.2 (2026-11-20, Sonnet main model, about $8 for the Claude suite):

- **What the hooks add is model- and task-dependent.** On Claude Sonnet the docs-missed task (`b3-docs-missed`) now
  passes 3/3 with or without the plugin; the 1.00 vs 0.33 gap measured on 0.1.0 did not reproduce. Where the model
  does slip, the hooks catch it: Codex on the same task 3/3 with hooks vs 2/3 with hooks off, and a `sed` that breaks
  a rule (`evals/manual/bash-edit.sh`) 3/3 repaired with the plugin vs 0/3 without.
- **Process behavior holds:** the reviewer catches both planted bugs and never the harmless rename (3/3); the loop
  uses two rounds and re-reviews only the findings (`f-review-loop` 2 of 3 runs full marks, one lost the final-report
  grader); fix mode keeps the test byte-identical (3/3); a parent folder of repos still gets the skill and the
  child's checks (3/3); a must-fix in a protected file stops the loop and hands the ruling over (3/3).
- **Not yet measured:** real sessions on the pilot repo (repeat violations, rounds, cost per task).

## Development

```
npm test
```

This repo follows its own process (`.claude/sdlc.json`): `npm test` is the verify command, and
`docs/business-map/` maps the plugin's flows (`python -m http.server 8765 --directory docs/business-map` to view it).
The hooks a session runs come from the installed plugin cache, not this checkout, so a hook change is live only after
reinstalling. Until then, run the checkout's hook by hand with a payload:
`echo '{"tool_name":"Edit","tool_input":{"file_path":"<abs path>"},"cwd":"<repo>","session_id":"dev"}' | node hooks/sdlc.mjs guard`.
Bump the patch version in every manifest with each pushed change to hooks or skills: `claude plugin update` compares versions, so a fix pushed under an installed version never arrives.

MIT license.
