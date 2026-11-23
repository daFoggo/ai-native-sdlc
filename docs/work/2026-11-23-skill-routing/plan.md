# Skill routing by path — Implementation Plan

> Build role: inline (this repo's sdlc.json names no build provider). Review: the sdlc loop, not a per-task review.

**Goal:** A repo maps code paths to skills in `sdlc.json`, and guard refuses the first edit of a matching file once
until that skill is loaded; lanes M and L start with a restatement.
**Architecture:** All new logic in `guard` (`hooks/sdlc.mjs`), state in the existing per-session seen file.
**Tech Stack:** Node ≥22.5, `node:test`.
**Spec:** docs/work/2026-11-23-skill-routing/spec.md. Approved by: owner (delegated), 2026-11-23. Record: none

## Global constraints
- No new hook events or matchers.
- One refusal per skill per agent per session; the next edit always passes.
- No `skills` key → guard output identical to 0.4.10.
- Version 0.4.11 in package.json, `.claude-plugin/`, `.codex-plugin/`, `.antigravity-plugin/` plugin.json and
  gemini-extension.json.

## Review focus
1. A file that matches two skills, one loaded: the message names only the missing one.
2. `Write` of a new file (no file on disk yet) is still routed.
3. A plugin-qualified invocation (`foo:bar`) satisfies a config `bar`; `xbar` does not.
4. A refused edit must not also trip protect/secret/approve ordering: protect still wins over the skill refusal.
5. Two sessions on one machine do not share loaded state.

### Task 1: onboard this repo
- Files: create `.claude/sdlc.json`.
- Content: `verify: "npm test"`; `check: [{glob: "{hooks,skills}/**/*.mjs", run: "node --check {file}"}]`;
  `protect: [{glob: "hooks/fixtures/**", reason: "payloads captured from real hosts; capture again, never hand-edit"}]`;
  `tests: ["**/*.test.mjs"]`; `artifacts: "docs/work"`; `debt: "ROADMAP.md"`.
- Test: `node hooks/sdlc.mjs start` with `{"cwd": "<repo>"}` on stdin prints the sdlc line.
- Standards: none (no rule cards).

### Task 2: skills routing in guard
- Files: `hooks/sdlc.mjs` (normalize, guard, a `seen(session)` read helper beside `seenOnce`); `hooks/sdlc.test.mjs`.
- Interfaces: `normalize(input).agent` = `input.agent_id ?? "main"`. Config `skills: [{glob, skill}]`.
- Tests (failing first), each with its own `session_id`:
  - `skill routing: first edit refused once naming the skill, next edit passes` — deny reason matches
    `/`vercel-react-best-practices`/` and the file; second identical call → `null`.
  - `skill routing: a Skill call (plain or plugin:name) satisfies it, a near name does not` — after
    `{tool_name:"Skill", tool_input:{skill:"x:bar"}}` an edit of a mapped file → `null`; with only `xbar` loaded → deny.
  - `skill routing: a subagent is asked on its own` — main loaded, `agent_id: "a1"` edit → deny.
  - `skill routing: only missing skills are named; protect wins; no skills key changes nothing` — covers focus 1, 4, 5.
  - `skill routing: Write of a new file is routed` — focus 2.
- Implementation: in `guard`, a `Skill` call writes `skill:<agent>:<name>` (name after the last `:`) via `seenOnce`
  before `guardDispatch`. In the per-file loop, after protect, fix mode, secret and approve checks pass, collect
  configured skills whose glob matches and that are neither loaded nor asked; if any, mark them asked and deny.
- Run: `npm test` → all pass.
- Standards: none.

### Task 3: docs and release
- Files: `skills/sdlc/SKILL.md` (§0 restate line; roles note on brainstorming filling intent + spec and on delegated
  approvals), `skills/sdlc-init/SKILL.md` (step 5 `skills` bullet: map only invocable skills), `README.md` (config
  example + one paragraph), `skills/sdlc/templates/sdlc.json` (`skills` entry), version files → 0.4.11.
- Test: `npm test` green; `grep -c '"skills"' README.md skills/sdlc/templates/sdlc.json` ≥ 1 each.
- Standards: none.

## Risks
- Guard ordering: the skill refusal must come last so a real block (protect, secret) is never hidden behind a
  reminder. Pinned by the protect test.
- The shared seen file now also holds skill keys; rule-card keys use `<root>:<card>`, no clash with `skill:` prefix.
