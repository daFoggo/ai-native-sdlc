# ai-native-sdlc

A Claude Code plugin that runs the [AI-Native SDLC Playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook)
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
| Docs are read only when the agent thinks of it | Path-scoped rule cards (`.claude/rules/*.md` with `paths:`) load when a matching file is touched; the review package hands the same cards to the reviewer |
| A rule written as prose cannot be enforced | `sdlc-init` turns every checkable rule into a lint rule or script; a hook runs it on each edited file and stays silent when it passes |
| "Done" is claimed without running anything | A Stop hook runs the project's verify command whenever the tree changed since the last green run |

Review is capped at three rounds (one full review, then at most two reviews of the fix only). Superpowers' own
measurements found that unbounded loops are the biggest source of cost variance, that re-reviewing the whole diff
each round keeps producing new findings instead of converging, and that cheap reviewer models miss planted
defects. So the reviewer runs on the most capable model, once, and re-reviews look only at the fix.

## Install

```
/plugin marketplace add daFoggo/ai-native-sdlc
/plugin install sdlc@ai-native-sdlc
```

The plugin does nothing in a repo until that repo has `.claude/sdlc.json`. Run the `sdlc-init` skill in a repo to
create it. Needs Node 22.5 or later (`path.matchesGlob`).

## What is inside

| Part | What it does |
|---|---|
| `skills/sdlc` | The process: lanes S/M/L, artifacts (`intent.md`, `spec.md`, `plan.md`), the review loop, the definition of done, the role → provider table |
| `skills/sdlc-init` | Onboards a repo: inventory the docs' rules, measure violations, enforce what a machine can, write rule cards, `sdlc.json`, `REVIEW.md` |
| `agents/reviewer.md` | Fresh-context reviewer on the most capable model; full and scoped modes; every finding needs a concrete failing case |
| `hooks/sdlc.mjs` | `guard` (protected paths, banned commands, read-only tests in fix mode), `check` (per-file check after each edit), `verify` (on Stop) |
| `skills/sdlc/scripts/review-package.mjs` | One file per review: commits, stat, the rule cards that bind the changed files, and the diff |

## `.claude/sdlc.json`

```json
{
  "verify": "pnpm check",
  "check": [{ "glob": "apps/web/**/*.{ts,tsx}", "cwd": "apps/web", "run": "pnpm exec eslint --max-warnings 0 {file}" }],
  "protect": [{ "glob": "packages/ui/src/components/ui/**", "reason": "vendored shadcn: change tokens or props" }],
  "denyBash": [{ "pattern": "npm install", "reason": "this repo uses pnpm" }],
  "tests": ["**/*.test.{ts,tsx}"],
  "riskyPaths": ["**/auth/**"],
  "providers": { "style": "ponytail:ponytail" }
}
```

`.claude/sdlc.local.json` (gitignored) overrides it per machine, for example `"pathPrepend": ["~/.local/node/bin"]`.
In a folder that holds several repos, the Stop hook verifies each child repo that has its own `sdlc.json`.

## Development

```
npm test
```

MIT license.
