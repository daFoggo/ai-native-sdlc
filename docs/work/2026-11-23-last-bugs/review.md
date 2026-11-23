# Review: last known bugs before real use (lane M)
Base: a65f42cf325f2bccaf0e963f563101c6a0200c11. R1 snapshot: 72d18fc848c426edf265413a0abef11f89d4f7a4.

## R1 (full, sonnet) — verdict: ship
- Minor 1 → Should. Ruling: raised — this change introduced it (a `./docs/map` or `docs\map` in sdlc.json silently
  dropped Flows touched) — cost if wrong: one line. Fixed for `map` and, same pattern, `artifacts`; test uses both
  spellings and fails without the fix.
- Not checked by the reviewer: that Claude and Codex send `stop_hook_active: false` on a new turn (Codex's captured
  Stop fixture has it; Claude's docs list it).

## R2 (scoped, sonnet) — verdict: ship
- Finding addressed. Minor: `map: "."` matches nothing (unrealistic, unchanged).

Ruling (no code): a Skill call from a cwd outside any sdlc repo stays unrecorded — R1-2 forbids seen files there —
cost if wrong: one extra refusal that passes on retry.
