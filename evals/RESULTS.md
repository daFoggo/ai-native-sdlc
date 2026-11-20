# Eval results

Runs on 2026-11-20. `claude plugin eval` uses Sonnet as the main model; the reviewer agent runs on Opus. Graders
are in each case's `case.yaml`. Before 0.3.1 every scaffold's verify command passed by mistake (`check.sh -r src`
treated `-r` as a file), so earlier runs never exercised the Stop gate; these runs do.

## Claude Code, plugin 0.3.2 ($7.7)

| Case | With plugin | Without | Note |
|---|---|---|---|
| `b-standards` | 3/3 | 3/3 | rule next to the request |
| `b2-copy-vendored` | 3/3 | 3/3 | prompt points at `docs/` |
| `b3-docs-missed` | 3/3 | 3/3 | on 0.1.0 it was 3/3 vs 1/3; did not reproduce |
| `e-reviewer` | 3/3 | n/a | both planted bugs, no false alarm |
| `f-review-loop` | 2/3 full, 1 at 0.75 | n/a | two rounds every run; one run's final report missed a grader |
| `g-fix-mode` | 3/3 | n/a | test unchanged, tests green |
| `h-parent-folder` | 3/3 | n/a | skill fires from the parent; child check holds |
| `i-review-stuck` | 3/3 | n/a | stops, leaves the protected file, hands over |

## Codex CLI 0.169, plugin 0.3.2 (`evals/manual/codex-docs-missed.sh`, ChatGPT plan)

| Arm | On standard |
|---|---|
| plugin, hooks on | 3/3 |
| plugin, hooks off (`--disable hooks`; the skill still loads) | 2/3 (one run copied the pixel values) |

An earlier attempt is discarded: its control arm did not actually disable the plugin, and two "with" runs produced
no file with their output lost; four later runs did not reproduce that.

## Manual checks

- `evals/manual/bash-edit.sh` (Claude, 0.1.1): `sed` that breaks a rule, 3/3 repaired with the plugin, 0/3 without.
- `evals/manual/integrations.sh` (Claude, 0.2.0): path-scoped rules reach a subagent; with superpowers installed, lane L
  invokes `writing-plans` and `executing-plans`. The reviewer was dispatched in lanes M and L, but those packages
  were empty because the work was uncommitted (fixed in 0.4.0: the package now covers the working tree), so those
  runs do not show the reviewer's quality; `e-`, `f-` and `i-` do.
- Antigravity CLI 1.4.12 (0.3.1): a rule-breaking edit was caught by `check`, injected on PostInvocation, and repaired.
