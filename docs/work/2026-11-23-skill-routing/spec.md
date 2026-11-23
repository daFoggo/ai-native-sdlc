# Spec: skill routing by path and the restate step (change 1 of 2)
Intent: docs/work/2026-11-23-skill-routing/intent.md. Status: approved (delegated). Record: none

## Requirements
1. `sdlc.json` accepts `"skills": [{ "glob": <glob or list>, "skill": "<name>" }]`. `sdlc.local.json` adds to it
   (existing list merge).
2. `guard` on a `Skill` call records the skill as loaded for that session and agent. A configured `name` matches an
   invoked `name` or `<plugin>:name`.
3. `guard` on a file edit: for each file, the configured skills whose glob matches and that are not loaded for this
   agent and have not been asked for yet → `deny` with one message naming every missing skill and the file. Those
   skills are then marked asked; the next edit passes whatever happens.
4. The agent key is `agent_id` from the hook input when present, else `main`. A subagent is asked on its own.
5. Without a `skills` key, or with no matching glob, guard answers exactly as before (existing tests stay green).
6. The message says: invoke the skill, then retry; if it does not apply or is not installed, say why and retry.
7. `skills/sdlc/SKILL.md` §0: lanes M and L start with a restatement (goal, problem, assumptions, questions that
   would change the direction), four lines at most; lane L's is the start of `intent.md`.
8. The roles table says how brainstorming fills both intent and spec (friction 3), and what to do when the user
   delegates the calls.
9. README, `templates/sdlc.json` and `sdlc-init` step 5 document `skills`; sdlc-init maps only skills the model can
   invoke (no `disable-model-invocation`).
10. This repo gets `.claude/sdlc.json` (verify `npm test`, check `node --check` on `.mjs`) so its own hooks run.

## Design
All in `guard` (`hooks/sdlc.mjs`): the PreToolUse matcher already covers `Skill` and the edit tools, so no new hook.
State lives in the existing per-session seen file (`sdlc-seen-<session>.json`, `seenOnce`), keys
`skill:<agent>:<name>` (loaded) and `skill-asked:<agent>:<name>`. `normalize` gains `agent`. Matching reuses
`findRoot`, `loadConfig`, `posixRelative`, `matches`. The Skill branch records before `guardDispatch` so the
subagent-driven refusal is unchanged (a refused SDD call is recorded too; harmless, no repo maps it).

## Approaches considered
- **Deny once in guard (chosen).** Deterministic, no new hook, degrades to a reminder on hosts without a Skill tool.
- Path-scoped rule cards that tell the agent to load the skill. No code, but prose the agent can skip: the bug.
- Also accept a `Read` of the skill's SKILL.md (for `disable-model-invocation` skills). Needs a `Read` matcher, a
  node start on every read; rejected, sdlc-init maps only invocable skills instead.
- Inject the skill list at SessionStart. Paid on every turn of every session; rejected.

## Areas of concern
- The Skill tool's `tool_input.skill` key is not in Claude Code's docs; the existing SDD refusal relies on it and
  works in evals.
- Codex has no hook for `$skill`; there the refusal is only a reminder (accepted).
- Claude re-attaches at most 25k tokens of invoked skills after compaction; an old skill can drop out while the seen
  file says loaded. Accepted: the refusal is a nudge, not a guarantee.
- A lane S edit to a mapped file pays one refused call. Accepted (one round trip).

## Open questions carried forward
None.
