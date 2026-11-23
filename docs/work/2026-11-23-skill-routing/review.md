# Review: skill routing (change 1)
Base: 29c747e9878378f419e9889af6c3bc24e89f215f. R1 snapshot: df4711a31d6333a25d86a2e137f88e8692c6a66d.

## R1 (full, opus) — verdict: fix 1
- Should 1: a plugin-qualified name in sdlc.json never matched the recorded bare name. Fixed: both sides go through
  `bareSkill`; test `R1-1`.
- Minor 2 → raised to Should. Ruling: raised — a Skill call in a repo that never opted in wrote a seen file and every
  MCP call read it, breaking the "no sdlc.json, nothing happens" promise and exposing an unlocked read to a hook
  error — cost if wrong: one extra line of code. Fixed: record only under an sdlc root, `skillGate` returns early
  without files; test `R1-2`.
- Minor 3 (no test that two sessions keep separate state) → debt (ROADMAP).
- Declined to judge (accepted per spec): a refused or denied Skill call counts as loaded; a `/slash` or agent
  `skills:` load still gets one refusal; Gemini/Antigravity skill activation does not satisfy the gate.
- Not checked by the reviewer: real Claude payloads for `agent_id` and `tool_input.skill` (no Claude fixture) → debt.

## R2 (scoped, sonnet) — verdict: ship
- Both findings addressed; no new breakage in the fix.
- Minor → debt: a Skill call is recorded only when the session cwd has an sdlc root (or child repos); a cwd wholly
  outside the repo gets one extra refusal.
- After R2: one clause added to SKILL.md §0 (friction 11: the intent provider's playback is the restatement). Prose
  only, not reviewed.
