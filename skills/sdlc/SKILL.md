---
name: sdlc
description: The development process for a repo that has an sdlc.json (in .agents/ or .claude/). Use at the start of any feature, bug fix, refactor or other code change there, to pick the lane, and again before review and before saying the work is done. Also use when asked to "follow the sdlc", review a change, or run the review loop.
---

# SDLC

One process from request to merge, after the AI-Native SDLC Playbook: each stage leaves a committed artifact the
next stage reads, machines enforce what they can, and humans decide at the gates. This skill names **roles**, not
tools: the repo's `sdlc.json` (in `.agents/` or `.claude/`) → `providers` says which skill fills each role (defaults
below), so a skill can be swapped by editing one line. It works the same on every agent host the plugin supports
(Claude Code, Codex, Antigravity, Gemini CLI); where a host lacks a feature, the step below says what replaces it.

## 0. Pick the lane

| Lane | When | Path |
|---|---|---|
| **S** | Copy, config, styling, a rename: no new logic | Do it → hooks check → done. No review. |
| **M** | A feature or fix inside one area | Short spec and plan in chat → build → verify → review loop (R1 always) |
| **L** | Several modules, a new subsystem, or any `riskyPaths` from sdlc.json (auth, money, migrations) | intent → spec → plan, each saved and approved → build → verify → review loop |

Say the lane in one line with the reason; the user can override. If the work grows, step up a lane and say so.
Note the commit you start from (`git rev-parse HEAD`): it is the review's `<base>`.

Size never skips review. A change with new logic (a branch, a computation, a parser, a data write) is lane M or L
however short it is, and lanes M and L always get R1; "too small for a reviewer" means it was lane S, which holds
only changes with no new logic. Pick the lane before building; never downgrade it afterwards to skip a step.

## 1. Artifacts (lane L; lane M keeps spec and plan in chat)

Under `docs/work/YYYY-MM-DD-<slug>/` (or `artifacts` in sdlc.json). Templates: [templates/](templates/). When the work
has a record elsewhere (a ticket, an incident), each artifact names its ID on the `Record:` line and the record gets
the artifact's commit, so neither system is orphaned. Intent can also start from an incident, a failed CI run or a
breached metric: write `intent.md` with `Source:` naming it and the evidence, then go through the same lanes.

1. `intent.md`: the problem in the originator's words, the outcome, who and what it touches, constraints, open
   questions. Role `intent`. The user approves it.
2. `spec.md`: requirements and design, written against the repo's docs and rules, with **Areas of concern** where
   policies conflict or the spec is unsure. Role `spec`. The user approves it.
3. `plan.md`: files that change, order, interfaces, the test that proves each step, risks, and a **Standards**
   line per task naming the rule cards (`.claude/rules/` or `.agents/rules/`) that bind it. Role `plan`. Plans are where review loops are
   prevented: an ambiguous plan is the main cause of extra rounds. When building departs from the plan, update
   `plan.md` in the same commit.

## 2. Build

- Role `build` executes the plan; role `style` (if set) governs how code is written.
- Tests: write the failing test first for new logic (a branch, parser, money, auth, data write) and for every bug
  fix. Copy, config and styling need none. This policy wins over any provider that says otherwise.
- Bug fix: write the failing test and see it fail for the expected reason, then run
  `node <plugin root>/hooks/sdlc.mjs fix on` from the repo (the plugin root is two folders above this skill's
  folder); tests are read-only until `fix off`. Fix the code, not the test.
- The hooks run the project's check after every edit and its verify command when you stop; a failing check comes
  back to you. They also refuse an edit that writes a secret into a tracked file, and pause for the user on the
  paths and commands sdlc.json lists under `approve`; the reason says who approves. Never weaken a check, a lint rule or a test to get green; a real exception gets an inline waiver
  that cites the doc that allows it.
- A deliberate shortcut gets a `shortcut: <limit>, <when to upgrade>` comment.

## 3. The review loop (lanes M and L): at most three reviews

The reviewer (role `review`) is always a fresh context on the most capable model; cheap reviewers miss defects.
On Claude Code it is the `sdlc:reviewer` agent. Elsewhere, start a fresh subagent whose instructions are
[references/reviewer.md](references/reviewer.md), on the strongest model the host offers, told to change nothing;
a host with no subagents gets the same file in a new session. Package the change first:
`node <this skill dir>/scripts/review-package.mjs <base>` prints a file with everything since `<base>` (committed or
not, new files included) and the rule cards that bind it.

1. **R1, full.** Dispatch the reviewer with the package path, the spec and plan paths, `mode: full`.
2. Sort the findings yourself: **Must fix** and **Should fix** enter ONE fix pass, all together; each fix gets a
   test that failed first. **Minor** goes to the debt list, never into the loop. A finding you reject is a
   ruling: `Ruling: <finding> — <why> — <cost if wrong>`.
3. **R2, scoped.** A new package from the same `<base>`; dispatch with `mode: scoped` and the open findings only.
4. Still open after R2: one more fix pass, then **R3, scoped**, the last one.
5. Anything open after R3 stops the loop: hand it to the user with your rulings. A fourth round does not
   converge; the problem is in the plan or the spec.

Skip none of the three steps you need, add none beyond them, and never review the whole diff again in R2 or R3.

## 4. Done

- The verify command passed on the final tree (the Stop hook runs it; read its result, do not assume).
- UI changes were opened in the running app; say what you exercised.
- Report: what changed, the review rounds used, every `Ruling:`, and the debt you added (`shortcut:` comments and
  deferred Minors, appended to `docs/debt.md` or the file named by `debt` in sdlc.json).
- A mistake corrected for the second time (by a review or by the user) goes into the repo's agent instructions
  (CLAUDE.md or AGENTS.md) in this change, so the next session starts with it. Say when a change made them stale.
- Commit, push and merge only when the user asks. The agent never approves its own work: the PR review in CI
  (`templates/ci/pr-review.yml`, when the repo uses it) and a human code owner come after this loop, not instead.

## 5. Measure

`node <this skill dir>/scripts/metrics.mjs [since]` prints the playbook's indicators from git: intent to spec to plan
times, spec rework after the plan, plan updates during the build, how often agent instructions and rule cards
change, and debt added. Run it when the user asks how the process is doing.

## Roles and default providers

Lane M does intent, spec, plan and build inline (in chat); their providers run in lane L, where the artifacts are
worth their cost. Review, style, debug and ui-new apply in every lane where they fit.

When a role applies and its provider is installed, invoke that skill (Claude: the Skill tool; Codex: `$name`;
Gemini and Antigravity: activate it) before doing the role,
and save what it produces in the artifact's place (its design doc becomes `spec.md`, its plan `plan.md`). The
sdlc rules above still bind it: the lanes, the test policy, the review cap. A provider that asks the user
questions one by one (brainstorming) is the one exception when the user said up front they will not answer:
then write intent and spec inline and say so. The exception covers only that provider; plan and build still go
through theirs (`writing-plans`, `executing-plans` ask nothing).
Override any of these in `sdlc.json` → `"providers": { "<role>": "<skill or 'inline'>" }`. If the named
skill is not installed, do the role inline with the template and say so in one line.

| Role | Default provider | Inline fallback |
|---|---|---|
| intent | `superpowers:brainstorming` | ask until the template's fields are concrete |
| spec | `superpowers:brainstorming` (its design doc, saved as `spec.md`) | fill `templates/spec.md` |
| plan | `superpowers:writing-plans` (saved as `plan.md`) | plan mode, saved with `templates/plan.md` |
| build | inline | work the plan task by task |
| style | `ponytail:ponytail` | the repo's CLAUDE.md or AGENTS.md |
| review | the reviewer (section 3) | same |
| ui-new | `hallmark` (new pages only; never on an existing design system) | the repo's design docs |
| debug | `superpowers:systematic-debugging` | reproduce → failing test → root cause → fix |

A provider's own artifact paths and loop limits yield to this skill: artifacts go where section 1 says, and its
review rounds count toward the three above (in superpowers' subagent-driven mode, set its per-task fix rounds to
one and keep only the final review here). Build defaults to inline because `superpowers:executing-plans` ends with
its own review, a commit and a workspace cleanup; a repo that sets it as `build` skips that final section, since
section 3 is the review. Committing stays the user's call: the artifacts and tests go into the change's commits
when the user asks for them.
