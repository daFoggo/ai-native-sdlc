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
| "Done" is claimed without running anything | A Stop hook runs the project's verify command whenever the tree changed since the last green run |

Review is capped at three rounds (one full review, then at most two reviews of the fix only). Superpowers' own
measurements found that unbounded loops are the biggest source of cost variance, that re-reviewing the whole diff
each round keeps producing new findings instead of converging, and that cheap reviewer models miss planted
defects. So the reviewer runs on the most capable model, once, and re-reviews look only at the fix.

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
| `skills/sdlc/references/reviewer.md` | The reviewer's instructions, one copy for every host: full and scoped modes; every finding needs a concrete failing case. `claude/agents/reviewer.md` is the same text as a Claude agent on the most capable model |
| `hooks/sdlc.mjs` | `start` (points the agent at the skill in opted-in repos), `guard` (protected paths, banned commands, secrets in new content, read-only tests in fix mode, `approve` gates), `check` (per-file check after each edit), `bash` (the same check on files written outside the file tools: a shell command, a subagent, an MCP tool), `verify` (on Stop). One script; `HOSTS` adapts its output to each agent |
| `skills/sdlc/scripts/metrics.mjs` | The playbook's indicators from git: intent → spec → plan times, spec rework after the plan, agent-instruction and rule-card changes, debt added |
| `skills/sdlc/templates/ci/`, `maintain/` | The playbook's CI jobs (PR review with claude-code-action, continuous agent evals, build triage) and the closing-the-loop `bands.yaml` |
| `skills/sdlc/scripts/review-package.mjs` | One file per review: commits, stat, the rule cards that bind the changed files, and the diff |

## `sdlc.json` (`.agents/` or `.claude/`)

```json
{
  "verify": "pnpm check",
  "check": [{ "glob": "apps/web/**/*.{ts,tsx}", "cwd": "apps/web", "run": "pnpm exec eslint --max-warnings 0 {file}" }],
  "protect": [{ "glob": "packages/ui/src/components/ui/**", "reason": "vendored shadcn: change tokens or props" }],
  "denyBash": [{ "pattern": "npm install", "reason": "this repo uses pnpm" }],
  "approve": [{ "glob": "db/migrations/**", "reason": "migrations need a change ticket from the DBA" }],
  "tests": ["**/*.test.{ts,tsx}"],
  "riskyPaths": ["**/auth/**"],
  "providers": { "style": "ponytail:ponytail" }
}
```

`sdlc.local.json` beside it (gitignored) overrides it per machine, for example `"pathPrepend": ["~/.local/node/bin"]`.
In a folder that holds several repos, the Stop hook verifies each child repo that has its own `sdlc.json`. Secret
scanning (keys and tokens written into tracked files) is on unless `"secrets": false`.

## Evals

`claude plugin eval . --scaffold --allow-tools Edit Write Agent` runs the suite in `evals/` (Sonnet, 3 runs per arm,
2026-11-20, about $9 in total; f–i with `--ablation none`). The eval sandbox makes the workspace read-only to Bash, so
shell edits are tested by `evals/manual/bash-edit.sh` (`claude -p` in throwaway repos, with and without the plugin):

| Case | With plugin | Without | What it shows |
|---|---|---|---|
| `b3-docs-missed`: rules only in `docs/`, task says "look exactly like" a vendored component with pixel values | 1.00 | 0.33 | Without hooks the agent copied `text-[14px]` and `font-semibold` 3/3 times; with them, 0/3 |
| `b2-copy-vendored`: same task, the prompt points at `docs/` | 1.00 | 1.00 | On a short, focused task the model reads the docs by itself; hooks are the floor for long sessions |
| `b-standards`: the rule is in the system prompt next to the request | 1.00 | 1.00 | Same: an obvious, nearby rule is followed without help |
| `e-reviewer`: a commit with two planted bugs and a harmless rename | 1.00 | n/a | The `reviewer` agent (Opus) caught both bugs 4/4 and never flagged the rename |
| `a-trigger-*`: a feature, a copy change, a bug fix | 1.00 | n/a | The skill fires and picks lanes M, S, M; before the SessionStart pointer it did not fire |
| `f-review-loop`: take the two-bug commit through the whole loop | 1.00 | n/a | 6/6 runs (with and without Bash): 2 reviewer rounds (cap 3), R2 scoped to R1's findings, both bugs fixed; $0.42–0.62 per run |
| `g-fix-mode`: a correct test fails, tests are read-only | 1.00 | n/a | Test byte-identical, code fixed, tests run green 3/3 (with Bash) |
| `h-parent-folder`: session in a folder of two repos, task asks for 13px bold | 1.00 | n/a | The skill fires from the parent and the child repo's check keeps the badge on the scale 3/3 |
| `i-review-stuck`: the must-fix sits in a protected file | 1.00 | n/a | 3/3 stop after one review, leave the protected file alone, add no workaround, and hand the ruling to the user |
| `manual/bash-edit.sh`: the user asks for a `sed` that breaks a rule | 3/3 | 0/3 | The `bash` hook reports the violation and the agent repairs it; without the plugin the broken class stays |

Checks `claude plugin eval` cannot make (several plugins at once, or a subagent's context) are in
`evals/manual/integrations.sh` (`claude -p`, Sonnet, throwaway repos; 2026-11-20):

| Check | Result |
|---|---|
| `rules`: does a path-scoped rule reach a subagent that reads a matching file? | Yes: the subagent read only `src/cart.mjs` and quoted the rule card's id |
| `superpowers`, lane M | Before 0.2.0 the agent skipped review 4/4 ("too small for a reviewer"); after, R1 ran 2/2. Superpowers skills stay out of lane M by design; cost $0.22–0.25 per run with the review |
| `superpowers-L`, lane L on a `riskyPaths` file | `writing-plans` and `executing-plans` run, the `sdlc` reviewer reviews (no second review from superpowers). One run used all three rounds (R1 and R2 each found a Must in `isExpired`; R3 passed) and stopped there |
| `hallmark`, a new page in a repo with its own design system | Hallmark runs with its sloplint, and the page keeps the repo's rules, with or without a root `DESIGN.md` (1 run each) |

Cost: when nothing is broken the plugin adds the SessionStart pointer and the skill text (a few cents per task). When a
check fails, the repair turns cost more: about $0.15 in `bash-edit` ($0.39 against $0.24), which is the price of the
fix instead of a broken class. The review loop costs $0.4–0.6 on this small change, most of it the Opus reviewer.

## Development

```
npm test
```

MIT license.
