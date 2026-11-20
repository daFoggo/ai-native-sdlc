---
name: sdlc
description: The development process for a repo that has .claude/sdlc.json. Use at the start of any feature, bug fix, refactor or other code change there, to pick the lane, and again before review and before saying the work is done. Also use when asked to "follow the sdlc", review a change, or run the review loop.
---

# SDLC

One process from request to merge, after the AI-Native SDLC Playbook: each stage leaves a committed artifact the
next stage reads, machines enforce what they can, and humans decide at the gates. This skill names **roles**, not
tools: the repo's `.claude/sdlc.json` → `providers` says which skill fills each role (defaults below), so a skill
can be swapped by editing one line.

## 0. Pick the lane

| Lane | When | Path |
|---|---|---|
| **S** | Copy, config, styling, a rename: no new logic | Do it → hooks check → done. No review. |
| **M** | A feature or fix inside one area | Short spec and plan in chat → build → verify → review loop (R1 always) |
| **L** | Several modules, a new subsystem, or any `riskyPaths` from sdlc.json (auth, money, migrations) | intent → spec → plan, each committed → build → verify → review loop |

Say the lane in one line with the reason; the user can override. If the work grows, step up a lane and say so.

Size never skips review. A change with new logic (a branch, a computation, a parser, a data write) is lane M or L
however short it is, and lanes M and L always get R1; "too small for a reviewer" means it was lane S, which holds
only changes with no new logic. Pick the lane before building; never downgrade it afterwards to skip a step.

## 1. Artifacts (lane L; lane M keeps spec and plan in chat)

Under `docs/work/YYYY-MM-DD-<slug>/` (or `artifacts` in sdlc.json). Templates: [templates/](templates/).

1. `intent.md`: the problem in the originator's words, the outcome, who and what it touches, constraints, open
   questions. Role `intent`. The user approves it.
2. `spec.md`: requirements and design, written against the repo's docs and rules, with **Areas of concern** where
   policies conflict or the spec is unsure. Role `spec`. The user approves it.
3. `plan.md`: files that change, order, interfaces, the test that proves each step, risks, and a **Standards**
   line per task naming the `.claude/rules/` files that bind it. Role `plan`. Plans are where review loops are
   prevented: an ambiguous plan is the main cause of extra rounds. When building departs from the plan, update
   `plan.md` in the same commit.

## 2. Build

- Role `build` executes the plan; role `style` (if set) governs how code is written.
- Tests: write the failing test first for new logic (a branch, parser, money, auth, data write) and for every bug
  fix. Copy, config and styling need none. This policy wins over any provider that says otherwise.
- Bug fix: commit the failing test, then run `node <plugin>/hooks/sdlc.mjs fix on` from the repo; tests are
  read-only until `fix off`. Fix the code, not the test.
- The hooks run the project's check after every edit and its verify command when you stop; a failing check comes
  back to you. Never weaken a check, a lint rule or a test to get green; a real exception gets an inline waiver
  that cites the doc that allows it.
- A deliberate shortcut gets a `shortcut: <limit>, <when to upgrade>` comment.

## 3. The review loop (lanes M and L): at most three reviews

The reviewer is the `reviewer` agent (role `review`), always a fresh context on the most capable model; cheap
reviewers miss defects. Package the change first:
`node <this skill dir>/scripts/review-package.mjs <base> [head]` prints a file with the diff and the bound rules.

1. **R1, full.** Dispatch `reviewer` with the package path, the spec and plan paths, `mode: full`.
2. Sort the findings yourself: **Must fix** and **Should fix** enter ONE fix pass, all together; each fix gets a
   test that failed first. **Minor** goes to the debt list, never into the loop. A finding you reject is a
   ruling: `Ruling: <finding> — <why> — <cost if wrong>`.
3. **R2, scoped.** New package from the commit R1 saw to HEAD; dispatch with `mode: scoped` and the open findings.
4. Still open after R2: one more fix pass, then **R3, scoped**, the last one.
5. Anything open after R3 stops the loop: hand it to the user with your rulings. A fourth round does not
   converge; the problem is in the plan or the spec.

Skip none of the three steps you need, add none beyond them, and never review the whole diff again in R2 or R3.

## 4. Done

- The verify command passed on the final tree (the Stop hook runs it; read its result, do not assume).
- UI changes were opened in the running app; say what you exercised.
- Report: what changed, the review rounds used, every `Ruling:`, and the debt you added (`shortcut:` comments and
  deferred Minors, appended to `docs/debt.md` or the file named by `debt` in sdlc.json).
- Commit, push and merge only when the user asks. The agent never approves its own work.

## Roles and default providers

Lane M does intent, spec, plan and build inline (in chat); their providers run in lane L, where the artifacts are
worth their cost. Review, style, debug and ui-new apply in every lane where they fit.

When a role applies and its provider is installed, invoke that skill with the Skill tool before doing the role,
and save what it produces in the artifact's place (its design doc becomes `spec.md`, its plan `plan.md`). The
sdlc rules above still bind it: the lanes, the test policy, the review cap. A provider that asks the user
questions one by one (brainstorming) is the one exception when the user said up front they will not answer:
then write intent and spec inline and say so. The exception covers only that provider; plan and build still go
through theirs (`writing-plans`, `executing-plans` ask nothing).
Override any of these in `.claude/sdlc.json` → `"providers": { "<role>": "<skill or 'inline'>" }`. If the named
skill is not installed, do the role inline with the template and say so in one line.

| Role | Default provider | Inline fallback |
|---|---|---|
| intent | `superpowers:brainstorming` | ask until the template's fields are concrete |
| spec | `superpowers:brainstorming` (its design doc, saved as `spec.md`) | fill `templates/spec.md` |
| plan | `superpowers:writing-plans` (saved as `plan.md`) | plan mode, saved with `templates/plan.md` |
| build | `superpowers:executing-plans` | work the plan task by task |
| style | `ponytail:ponytail` | the repo's CLAUDE.md |
| review | the `reviewer` agent | same |
| ui-new | `hallmark` (new pages only; never on an existing design system) | the repo's design docs |
| debug | `superpowers:systematic-debugging` | reproduce → failing test → root cause → fix |

A provider's own artifact paths and loop limits yield to this skill: artifacts go where section 1 says, and its
review rounds count toward the three above (in superpowers' subagent-driven mode, set its per-task fix rounds to
one and keep only the final review here).
